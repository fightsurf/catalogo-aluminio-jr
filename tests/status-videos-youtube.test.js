'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const raiz = path.join(__dirname, '..');
const fonte = fs.readFileSync(path.join(raiz, 'src/services/status-videos/status-videos.service.js'), 'utf8');
const pendente = {
  canal: 'youtube_shorts', status: 'aguardando_limite', motivo: 'uploadLimitExceeded',
  aviso: 'Limite de uploads do YouTube atingido.', proxima_tentativa_em: '2026-11-25T13:30:00.000Z',
};

function ambiente({ duravel = new Map(), canal = pendente, falharRedes = false } = {}) {
  const chamadas = { redes: [], videos: 0, r2: 0, youtube: 0, arquivosRemovidos: [], snapshotsAntesUpload: [] };
  const timers = [];
  const fila = {
    async obter({ requestId }) { return duravel.has(requestId) ? structuredClone(duravel.get(requestId)) : null; },
    async publicarOuAgendar(opcoes) {
      chamadas.youtube++;
      chamadas.snapshotsAntesUpload.push(structuredClone(opcoes.contexto));
      assert.equal(opcoes.videoUrl, 'https://r2.test/status-videos/final.mp4');
      assert.equal(opcoes.caminho, '/temp/final.mp4');
      if (!duravel.has(opcoes.requestId)) {
        duravel.set(opcoes.requestId, {
          canal: structuredClone(canal), contexto: structuredClone(opcoes.contexto),
          criado_em: '2026-11-24T13:30:00.000Z', atualizado_em: '2026-11-24T13:30:00.000Z',
        });
      }
      return structuredClone(duravel.get(opcoes.requestId).canal);
    },
    async salvarContexto({ requestId, contexto }) {
      const registro = duravel.get(requestId);
      if (!registro) throw new Error('Registro ausente');
      registro.contexto = structuredClone(contexto);
    },
  };
  const publicarRede = nome => async () => {
    chamadas.redes.push(nome);
    if (falharRedes) throw new Error(`Falha simulada: ${nome}`);
    return { post_id: `${nome}-post`, video_id: `${nome}-video`, media_id: `${nome}-media`, zapi: { messageId: `${nome}-msg` } };
  };
  const dependencias = {
    'fs/promises': { async unlink(arquivo) { chamadas.arquivosRemovidos.push(arquivo); } },
    '../../../db/connection': { async query() { throw new Error('SQL inesperado no cenário promocional'); } },
    './videoOverlay.service': {
      WHATSAPP_LIMITE_SEGURO_BYTES: 10 * 1024 * 1024,
      async gerarVideoFinal() { chamadas.videos++; return { caminho: '/temp/final.mp4', duracao_segundos: 30 }; },
      async tamanhoArquivoBytes() { return 1000; },
      async gerarVideoWhatsapp() { return { caminho: '/temp/final.mp4', temporario: false, tamanho_bytes: 1000 }; },
    },
    '../cloudflare/cloudflareR2.service': { async uploadArquivoLocal() { chamadas.r2++; return { url: 'https://r2.test/status-videos/final.mp4' }; } },
    '../integracoes/zapi.service': { enviarVideoStatus: publicarRede('whatsapp') },
    '../integracoes/instagram.service': { publicarStoryVideo: publicarRede('instagram_story'), diagnosticarConfiguracao() { return {}; } },
    '../integracoes/facebook.service': {
      publicarStoryVideo: publicarRede('facebook_story'), publicarFeedVideo: publicarRede('facebook_feed'), diagnosticarConfiguracao() { return {}; },
    },
    '../integracoes/youtube.service': { diagnosticarConfiguracao() { return { configurado: true }; } },
    '../integracoes/youtube-fila.service': fila,
    '../termometro/termometroAparicoes.service': { async registrarStatusVideos() {} },
  };
  const modulo = { exports: {} };
  new Function('require', 'module', 'exports', 'setTimeout', 'console', fonte)(nome => {
    if (Object.hasOwn(dependencias, nome)) return dependencias[nome];
    throw new Error(`Dependência inesperada: ${nome}`);
  }, modulo, modulo.exports, (fn, ms) => { timers.push({ fn, ms }); return { unref() {} }; }, { log() {}, error() {} });
  return { service: modulo.exports, fila, chamadas, duravel, timers };
}

function requisicao(id, arquivo = '/temp/original.mp4') {
  return { arquivo: { path: arquivo, size: 1000 }, requestId: id, tipoVideo: 'promocional', itens: [] };
}

async function concluir(service, id) {
  for (let i = 0; i < 30; i++) {
    const job = await service.obterPublicacao(id);
    if (job?.status === 'concluido') return job;
    if (job?.status === 'erro') throw new Error(job.erro);
    await new Promise(resolve => setImmediate(resolve));
  }
  throw new Error('Publicação não terminou');
}

test('limite mantém os quatro destinos confirmados e salva contexto antes do envio YouTube', async () => {
  const a = ambiente();
  await a.service.iniciarPublicacao(requisicao('sv-limite'));
  const job = await concluir(a.service, 'sv-limite');
  assert.equal(job.resultado.status_geral, 'parcial');
  assert.equal(job.resultado.success, false);
  assert.deepEqual(job.resultado.canais.youtube_shorts, pendente);
  assert.deepEqual(a.chamadas.redes, ['whatsapp', 'instagram_story', 'facebook_story', 'facebook_feed']);
  const antes = a.chamadas.snapshotsAntesUpload[0];
  for (const rede of a.chamadas.redes) assert.equal(antes.canais[rede].status, 'publicado');
  assert.equal(antes.video_url, 'https://r2.test/status-videos/final.mp4');
  assert.ok(a.chamadas.arquivosRemovidos.includes('/temp/original.mp4'));
  assert.ok(a.chamadas.arquivosRemovidos.includes('/temp/final.mp4'));
});

test('consulta sobrevive restart e incorpora somente o sucesso posterior do YouTube', async () => {
  const a = ambiente();
  await a.service.iniciarPublicacao(requisicao('sv-restart'));
  const original = await concluir(a.service, 'sv-restart');
  const reiniciado = ambiente({ duravel: a.duravel });
  const aguardando = await reiniciado.service.obterPublicacao('sv-restart');
  assert.deepEqual(aguardando.resultado.canais, original.resultado.canais);
  a.duravel.get('sv-restart').canal = {
    canal: 'youtube_shorts', status: 'publicado', video_id: 'video-novo', url: 'https://www.youtube.com/shorts/video-novo',
  };
  const publicado = await reiniciado.service.obterPublicacao('sv-restart');
  assert.equal(publicado.resultado.status_geral, 'publicado');
  assert.equal(publicado.resultado.success, true);
  for (const rede of a.chamadas.redes) assert.deepEqual(publicado.resultado.canais[rede], original.resultado.canais[rede]);
  assert.deepEqual(reiniciado.chamadas.redes, []);
  assert.equal(reiniciado.chamadas.youtube, 0);
});

test('repetir request concluído no cache e após expiração não publica novamente', async () => {
  const a = ambiente();
  await a.service.iniciarPublicacao(requisicao('sv-duplicada'));
  await concluir(a.service, 'sv-duplicada');
  await a.service.iniciarPublicacao(requisicao('sv-duplicada', '/temp/repetido-1.mp4'));
  for (const timer of a.timers.filter(item => item.ms === 2 * 60 * 60 * 1000)) timer.fn();
  const repetida = await a.service.iniciarPublicacao(requisicao('sv-duplicada', '/temp/repetido-2.mp4'));
  assert.equal(repetida.resultado.canais.youtube_shorts.status, 'aguardando_limite');
  assert.equal(a.chamadas.videos, 1);
  assert.equal(a.chamadas.r2, 1);
  assert.equal(a.chamadas.youtube, 1);
  assert.equal(a.chamadas.redes.length, 4);
  assert.ok(a.chamadas.arquivosRemovidos.includes('/temp/repetido-1.mp4'));
  assert.ok(a.chamadas.arquivosRemovidos.includes('/temp/repetido-2.mp4'));
});

test('duas requisições simultâneas com mesmo ID iniciam só uma publicação', async () => {
  const a = ambiente();
  await Promise.all([
    a.service.iniciarPublicacao(requisicao('sv-concorrente')),
    a.service.iniciarPublicacao(requisicao('sv-concorrente', '/temp/duplicado.mp4')),
  ]);
  await concluir(a.service, 'sv-concorrente');
  assert.equal(a.chamadas.videos, 1);
  assert.equal(a.chamadas.youtube, 1);
  assert.equal(a.chamadas.redes.length, 4);
});

test('consulta indisponível preserva resultado em memória e continua impedindo reenvio', async () => {
  const a = ambiente();
  await a.service.iniciarPublicacao(requisicao('sv-cache-indisponivel'));
  await concluir(a.service, 'sv-cache-indisponivel');
  a.fila.obter = async () => { throw new Error('Banco temporariamente indisponível'); };
  const ultima = await a.service.obterPublicacao('sv-cache-indisponivel');
  assert.equal(ultima.resultado.canais.whatsapp.status, 'publicado');
  assert.equal(ultima.resultado.canais.youtube_shorts.status, 'aguardando_limite');
  assert.match(ultima.resultado.aviso, /último resultado confirmado/);
  await a.service.iniciarPublicacao(requisicao('sv-cache-indisponivel', '/temp/repetido.mp4'));
  assert.equal(a.chamadas.redes.length, 4);
  assert.equal(a.chamadas.videos, 1);
  await assert.rejects(a.service.iniciarPublicacao(requisicao('sv-sem-cache')), /Banco temporariamente/);
  assert.equal(a.chamadas.videos, 1);
});

test('registro sem snapshot após interrupção não autoriza reenvio dos outros destinos', async () => {
  const duravel = new Map([['sv-sem-contexto', { canal: pendente, contexto: null }]]);
  const a = ambiente({ duravel });
  const job = await a.service.iniciarPublicacao(requisicao('sv-sem-contexto'));
  assert.equal(job.resultado.canais.youtube_shorts.status, 'aguardando_limite');
  for (const rede of ['whatsapp', 'instagram_story', 'facebook_story', 'facebook_feed']) {
    assert.equal(job.resultado.canais[rede].status, 'incerto');
  }
  assert.equal(a.chamadas.videos, 0);
  assert.deepEqual(a.chamadas.redes, []);
});

test('pendência do YouTube sem destinos publicados continua aguardando, sem falso sucesso', async () => {
  const a = ambiente({ falharRedes: true });
  const resultado = await a.service.publicar(requisicao('sv-outros-erros'));
  assert.equal(resultado.status_geral, 'aguardando');
  assert.equal(resultado.success, false);
  assert.equal(resultado.canais.facebook_feed.status, 'erro');
});

test('erro definitivo do YouTube não vira limite e não apaga destinos publicados', async () => {
  const a = ambiente({ canal: { canal: 'youtube_shorts', status: 'erro', erro: 'Título inválido' } });
  const resultado = await a.service.publicar(requisicao('sv-erro'));
  assert.equal(resultado.canais.youtube_shorts.status, 'erro');
  assert.equal(resultado.canais.youtube_shorts.proxima_tentativa_em, undefined);
  assert.equal(resultado.status_geral, 'parcial');
  assert.equal(resultado.canais.whatsapp.status, 'publicado');
});

test('controller aguarda a consulta persistente antes de responder', async () => {
  const codigo = fs.readFileSync(path.join(raiz, 'src/controllers/status-videos/status-videos.controller.js'), 'utf8');
  const modulo = { exports: {} };
  const esperado = { request_id: 'sv-controller', status: 'concluido', resultado: { canais: { youtube_shorts: pendente } } };
  new Function('require', 'module', 'exports', codigo)(() => ({ async obterPublicacao() { return esperado; } }), modulo, modulo.exports);
  let resposta;
  const res = { status() { return res; }, json(data) { resposta = data; } };
  await modulo.exports.statusPublicacao({ params: { requestId: 'sv-controller' } }, res);
  assert.deepEqual(resposta, { success: true, data: esperado });
});

function apresentacaoFrontend() {
  const html = fs.readFileSync(path.join(raiz, 'views/status-videos/status-videos.html'), 'utf8');
  const inicio = html.indexOf('  function apresentarCanal(c) {');
  const fim = html.indexOf('  function guardarUltimaPublicacao(id) {', inicio);
  const esc = valor => String(valor ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const els = { resultado: { hidden: true, innerHTML: '' } };
  const funcoes = new Function('els', 'esc', `${html.slice(inicio, fim)}\nreturn { apresentarCanal, renderResultado };`)(els, esc);
  return { ...funcoes, els };
}

test('interface renderiza limite em amarelo, prazo de Brasília e destinos concluídos em verde', () => {
  const a = apresentacaoFrontend();
  a.renderResultado({ status_geral: 'parcial', canais: { youtube_shorts: pendente, whatsapp: { status: 'publicado' } } });
  assert.match(a.els.resultado.innerHTML, /status-aguardando/);
  assert.match(a.els.resultado.innerHTML, /Limite de uploads do YouTube atingido/);
  assert.match(a.els.resultado.innerHTML, /25\/11\/2026, 10:30:00/);
  assert.match(a.els.resultado.innerHTML, /Brasília/);
  assert.match(a.els.resultado.innerHTML, /status-ok/);
  assert.equal(a.apresentarCanal(pendente).rotulo, '🟡 aguardando');
});

test('interface distingue erro definitivo, envio ativo e confirmação incerta', () => {
  const a = apresentacaoFrontend();
  assert.equal(a.apresentarCanal({ status: 'erro', erro: 'Falha' }).classe, 'status-erro');
  assert.equal(a.apresentarCanal({ status: 'processando' }).rotulo, 'processando');
  assert.equal(a.apresentarCanal({ status: 'aguardando' }).rotulo, 'aguardando');
  assert.equal(a.apresentarCanal({ status: 'incerto' }).rotulo, 'conferir');
  assert.equal(a.apresentarCanal({ ...pendente, proxima_tentativa_em: 'inválida' }).detalhe.includes('Invalid Date'), false);
});
