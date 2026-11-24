'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Readable, Writable } = require('node:stream');

const source = fs.readFileSync(path.join(__dirname, '../src/services/integracoes/youtube.service.js'), 'utf8');
const limite = {
  error: {
    message: 'The user has exceeded the number of videos they may upload.',
    errors: [{ reason: 'uploadLimitExceeded' }],
  },
};
const canal = 'UCTfWT1Vr3o7sFTYBAmgw-sA';

function ambiente(options = {}) {
  const chamadas = [];
  const env = {
    YOUTUBE_CLIENT_ID: 'client-teste',
    YOUTUBE_CLIENT_SECRET: 'secret-teste',
    YOUTUBE_REFRESH_TOKEN: 'refresh-teste',
    YOUTUBE_CHANNEL_ID: canal,
    ...options.env,
  };
  const fetch = async (url, config) => {
    chamadas.push({ tipo: 'fetch', url: String(url), config });
    if (String(url).includes('oauth2.googleapis.com')) {
      if (options.oauthError) throw new Error('OAuth indisponível');
      return new Response(JSON.stringify({ access_token: 'access-teste' }));
    }
    if (options.inicioStatus) return new Response(JSON.stringify(options.body || limite), { status: options.inicioStatus });
    return new Response('', { headers: { location: 'https://www.googleapis.com/upload/youtube/v3/videos?upload_id=teste' } });
  };
  const fakeRequire = name => {
    if (name === 'fs/promises') return { stat: async () => ({ isFile: () => true, size: 5 }) };
    if (name === 'fs') return { createReadStream: () => Readable.from(Buffer.from('video')) };
    if (name === 'https') return {
      request(config, callback) {
        chamadas.push({ tipo: 'upload', config });
        const req = new Writable({
          autoDestroy: false,
          write(_chunk, _encoding, done) { done(); },
          final(done) {
            done();
            setImmediate(() => {
              if (options.networkError) return req.destroy(new Error('conexão interrompida'));
              const res = options.aborted ? new Readable({ read() {} }) : Readable.from([JSON.stringify(options.body || { id: 'video-teste', status: { privacyStatus: 'public' } })]);
              res.statusCode = options.uploadStatus || 200;
              callback(res);
              if (options.aborted) setImmediate(() => res.emit('aborted'));
            });
          },
        });
        return req;
      },
    };
    return require(name);
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'fetch', 'process', source)(fakeRequire, module, module.exports, fetch, { env });
  return { service: module.exports, chamadas, env };
}

const video = { caminho: '/video-simulado.mp4', titulo: 'Teste', descricao: 'Descrição', tags: [] };

test('preserva o motivo uploadLimitExceeded na abertura da sessão e não envia o arquivo', async () => {
  const { service, chamadas } = ambiente({ inicioStatus: 400 });
  await assert.rejects(service.publicarShort(video), error => {
    assert.equal(error.statusCode, 400);
    assert.deepEqual(error.reasons, ['uploadLimitExceeded']);
    assert.equal(service.limiteUploadAtingido(error), true);
    assert.equal(error.envioIncerto, false);
    assert.equal(error.uploadIniciado, false);
    return true;
  });
  assert.equal(chamadas.filter(c => c.tipo === 'upload').length, 0);
});

test('preserva uploadLimitExceeded quando a rejeição chega no PUT do vídeo', async () => {
  const { service } = ambiente({ uploadStatus: 400, body: limite });
  await assert.rejects(service.publicarShort(video), error => {
    assert.equal(error.reason, 'uploadLimitExceeded');
    assert.equal(error.uploadIniciado, true);
    assert.equal(error.envioIncerto, false);
    assert.equal(service.limiteUploadAtingido(error), true);
    return true;
  });
});

test('quotaExceeded, HTTP 400 genérico e outros motivos não se confundem com limite de uploads', async () => {
  const { service } = ambiente();
  assert.equal(service.limiteUploadAtingido(new Error('YouTube Data API respondeu 400: The user has exceeded the number of videos they may upload.')), true);
  assert.equal(service.limiteUploadAtingido({ reason: 'quotaExceeded', message: limite.error.message }), false);
  assert.equal(service.limiteUploadAtingido({ statusCode: 400, message: 'invalidTitle' }), false);
  assert.equal(service.limiteUploadAtingido({ reasons: ['forbidden'] }), false);
  const quota = ambiente({ inicioStatus: 403, body: { error: { message: 'Quota exceeded', errors: [{ reason: 'quotaExceeded' }] } } });
  await assert.rejects(quota.service.publicarShort(video), error => error.reason === 'quotaExceeded' && !quota.service.limiteUploadAtingido(error));
});

test('sucesso conserva ID, URL e privacidade do upload', async () => {
  const { service, chamadas } = ambiente();
  const r = await service.publicarShort(video);
  assert.equal(r.status, 'publicado');
  assert.equal(r.video_id, 'video-teste');
  assert.equal(r.url, 'https://www.youtube.com/shorts/video-teste');
  assert.equal(r.privacy_status, 'public');
  assert.equal(chamadas.filter(c => c.tipo === 'upload').length, 1);
  assert.ok(chamadas.filter(c => c.tipo === 'fetch').every(c => c.config.signal));
});

test('queda de conexão, HTTP 5xx e resposta sem ID após envio exigem conferência antes de repetir', async () => {
  for (const options of [{ networkError: true }, { aborted: true }, { uploadStatus: 503, body: { error: { message: 'Unavailable' } } }, { body: {} }]) {
    const { service } = ambiente(options);
    await assert.rejects(service.publicarShort(video), error => error.uploadIniciado === true && error.envioIncerto === true);
  }
});

test('falha de OAuth antes do upload não indica publicação incerta', async () => {
  const { service, chamadas } = ambiente({ oauthError: true });
  await assert.rejects(service.publicarShort(video), error => error.uploadIniciado === false && error.envioIncerto === false);
  assert.equal(chamadas.filter(c => c.tipo === 'upload').length, 0);
});

test('pausa é identificada pelo canal sem exigir escopo adicional e nunca grava token na chave', () => {
  const a = ambiente({ env: { YOUTUBE_CHANNEL_ID: `"https://www.youtube.com/channel/${canal}/"` } });
  assert.equal(a.service.identificarCanal(), `canal:${canal}`);
  const b = ambiente({ env: { YOUTUBE_CHANNEL_ID: '' } });
  const chave = b.service.identificarCanal();
  assert.match(chave, /^conexao:[a-f0-9]{64}$/);
  assert.ok(!chave.includes('refresh-teste'));
  b.env.YOUTUBE_REFRESH_TOKEN = 'outro-refresh';
  assert.notEqual(b.service.identificarCanal(), chave);
});
