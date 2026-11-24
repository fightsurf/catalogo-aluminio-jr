'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { EventEmitter } = require('node:events');

const fonte = fs.readFileSync(path.join(__dirname, '../src/services/integracoes/youtube-fila.service.js'), 'utf8');
const DIA = 24 * 60 * 60 * 1000;
const mp4 = Buffer.from('000000186674797069736f6d0000000069736f6d', 'hex');
const limite = () => Object.assign(new Error('The user has exceeded the number of videos they may upload.'), { reason: 'uploadLimitExceeded', statusCode: 400, envioIncerto: false });
const sucesso = id => ({ video_id: id, url: `https://www.youtube.com/shorts/${id}`, privacy_status: 'public' });

// Banco isolado compartilhado entre instâncias do serviço: guarda as linhas e
// disputa locks de sessão, permitindo verificar retomada e concorrência sem rede.
function harness() {
  let db = { jobs: new Map(), pausas: new Map() };
  const locks = new Map();
  let agora = Date.parse('2026-11-24T10:00:00Z');
  let n = 0, falhar;
  const stats = { uploads: [], downloads: [], solturas: 0, descartadas: 0, logs: [] };
  const conexoes = [];
  const key = (origem, id) => `${origem}:${id}`;
  const result = row => ({ rows: row ? [structuredClone(row)] : [], rowCount: row ? 1 : 0 });
  const row = p => db.jobs.get(key(p[0], p[1]));
  const ready = j => !j.proxima_tentativa_em || new Date(j.proxima_tentativa_em).getTime() <= agora;
  const api = {
    canal: 'canal-principal', upload: async () => sucesso('video-teste'),
    download: async () => new Response(mp4, { headers: { 'content-type': 'video/mp4', 'content-length': String(mp4.length) } }),
  };

  function execute(sql, p = [], clientId = 0) {
    const q = sql.replace(/\s+/g, ' ').trim();
    if (falhar && q.includes(falhar)) { falhar = null; throw new Error('Falha de banco simulada'); }
    if (q.startsWith('CREATE ')) return result();
    if (q.startsWith('SELECT pg_try_advisory_lock')) {
      const locked = !locks.has(p[0]);
      if (locked) locks.set(p[0], clientId);
      return result({ locked });
    }
    if (q.startsWith('SELECT pg_advisory_unlock')) {
      assert.equal(locks.get(p[0]), clientId);
      locks.delete(p[0]); return result({ pg_advisory_unlock: true });
    }
    if (q.startsWith('SELECT * FROM youtube_upload_fila')) return result(row(p));
    if (q.startsWith('INSERT INTO youtube_upload_fila')) {
      if (row(p)) return result();
      const j = { origem: p[0], request_id: p[1], canal_chave: p[2], video_url: p[3],
        metadados: JSON.parse(p[4]), contexto: JSON.parse(p[5]), estado: 'pendente',
        tentativas: 0, proxima_tentativa_em: null, resultado: null, erro: null,
        criado_em: new Date(agora).toISOString(), atualizado_em: new Date(agora).toISOString() };
      db.jobs.set(key(p[0], p[1]), j); return result({ request_id: j.request_id });
    }
    if (q.startsWith('SELECT bloqueado_ate FROM youtube_upload_pausas')) {
      const pause = db.pausas.get(p[0]);
      return result(pause && new Date(pause.bloqueado_ate).getTime() > agora ? pause : null);
    }
    if (q.startsWith('INSERT INTO youtube_upload_pausas')) {
      const pause = { bloqueado_ate: new Date(agora + DIA).toISOString() };
      db.pausas.set(p[0], pause); return result(pause);
    }
    if (q.startsWith('SELECT 1 FROM youtube_upload_fila')) return result(row(p) && ready(row(p)) ? { ok: 1 } : null);
    if (q.startsWith('SELECT origem,request_id FROM youtube_upload_fila')) {
      const jobs = [...db.jobs.values()].filter(j =>
        ['pendente', 'preparando', 'enviando', 'aguardando_limite'].includes(j.estado) && ready(j)).slice(0, 20);
      return { rows: jobs.map(j => ({ origem: j.origem, request_id: j.request_id })), rowCount: jobs.length };
    }
    if (q.startsWith('UPDATE youtube_upload_fila')) {
      const j = row(p); if (!j) return result();
      if (q.includes('SET contexto=')) j.contexto = JSON.parse(p[2]);
      else if (q.includes('SET estado=$3')) Object.assign(j, { estado: p[2], erro: p[3], resultado: JSON.parse(p[4]), proxima_tentativa_em: null });
      else if (q.includes("SET estado='aguardando_limite'")) Object.assign(j, { estado: 'aguardando_limite', proxima_tentativa_em: new Date(p[2]).toISOString(), erro: null });
      else if (q.includes("SET estado='enviando'")) { j.estado = 'enviando'; j.tentativas++; }
      else throw Error('UPDATE não coberto: ' + q);
      j.atualizado_em = new Date(agora).toISOString();
      return result(j);
    }
    throw Error('SQL não coberto: ' + q);
  }
  const pool = {
    query: async (sql, p) => execute(sql, p),
    connect: async () => {
      const clientId = ++n; let transacao;
      const client = Object.assign(new EventEmitter(), {
        query: async (sql, p) => {
          if (sql === 'BEGIN') { transacao = structuredClone(db); return result(); }
          if (sql === 'COMMIT') { transacao = undefined; return result(); }
          if (sql === 'ROLLBACK') { db = transacao; transacao = undefined; return result(); }
          return execute(sql, p, clientId);
        },
        release: error => {
          stats.solturas++; if (error) stats.descartadas++;
          const own = [...locks.entries()].filter(([, owner]) => owner === clientId);
          if (error) own.forEach(([canal]) => locks.delete(canal));
          else assert.equal(own.length, 0, 'Não devolver conexão com lock ao pool');
        },
      });
      conexoes.push(client);
      return client;
    },
  };
  function carregar() {
    const mod = { exports: {} };
    new Function('require', 'module', 'exports', 'fetch', 'process', 'console', fonte)(name => {
      if (name === '../../../db/connection') return pool;
      if (name === './youtube.service') return {
        identificarCanal: () => api.canal,
        limiteUploadAtingido: e => e.reason === 'uploadLimitExceeded',
        publicarShort: async args => { stats.uploads.push(args); return api.upload(args); },
      };
      if (name.startsWith('node:')) return require(name);
      throw Error('Dependência inesperada: ' + name);
    }, mod, mod.exports, async (url, options) => {
      stats.downloads.push({ url, options }); return api.download(url, options);
    }, { env: { CLOUDFLARE_R2_PUBLIC_URL: '"https://r2.test/assets/"' } }, {
      error: (...args) => stats.logs.push(args),
    });
    return mod.exports;
  }
  return { api, stats, carregar, avancar: ms => { agora += ms; },
    estado: () => db, falhar: trecho => { falhar = trecho; },
    perderConexao: () => conexoes.at(-1).emit('error', new Error('Conexão interrompida')),
    job: id => db.jobs.get(key('status-videos', id)) };
}
async function arquivo(t) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'jr-fila-test-'));
  t.after(() => fsp.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'video.mp4'); await fsp.writeFile(file, mp4); return file;
}
function args(requestId, caminho, extras = {}) {
  return { requestId, caminho, videoUrl: `https://r2.test/assets/status-videos/${requestId}.mp4`,
    titulo: 'Vídeo teste', descricao: 'Descrição preservada', tags: ['Teste'], ...extras };
}

test('rejeição do limite persiste 24h e consulta/duplo clique não estendem a pausa', async t => {
  const h = harness(), fila = h.carregar(), file = await arquivo(t);
  h.api.upload = async () => { throw limite(); };
  const primeiro = await fila.publicarOuAgendar(args('primeiro', file));
  assert.equal(primeiro.status, 'aguardando_limite');
  assert.equal(primeiro.proxima_tentativa_em, '2026-11-25T10:00:00.000Z');
  h.avancar(3 * 60 * 60 * 1000);
  const consulta = await fila.obter({ requestId: 'primeiro' });
  const repetida = await fila.publicarOuAgendar(args('primeiro', file));
  await fila.processarPendentes();
  assert.equal(consulta.canal.proxima_tentativa_em, primeiro.proxima_tentativa_em);
  assert.equal(repetida.proxima_tentativa_em, primeiro.proxima_tentativa_em);
  assert.equal(repetida.repetida, true);
  assert.equal(h.stats.uploads.length, 1);
  assert.equal(h.stats.downloads.length, 0);
});

test('novos jobs do canal compartilham a pausa sem baixar nem enviar', async t => {
  const h = harness(), fila = h.carregar(), file = await arquivo(t);
  h.api.upload = async () => { throw limite(); };
  const a = await fila.publicarOuAgendar(args('a', file));
  h.avancar(60000);
  const b = await fila.publicarOuAgendar(args('b', file));
  assert.equal(a.proxima_tentativa_em, b.proxima_tentativa_em);
  assert.equal(h.stats.uploads.length, 1);
  assert.equal(h.stats.downloads.length, 0);
  h.api.canal = 'outro-canal'; h.api.upload = async () => sucesso('outra-conta');
  assert.equal((await fila.publicarOuAgendar(args('c', file))).status, 'publicado');
});

test('reinício recupera o MP4 e retoma só YouTube preservando contexto e IDs externos', async t => {
  const h = harness(), fila = h.carregar(), file = await arquivo(t);
  const contexto = { canais: { whatsapp: { status: 'publicado', id: 'zap-1' },
    instagram_story: { status: 'publicado', media_id: 'ig-1' }, facebook_feed: { status: 'publicado', post_id: 'fb-1' } } };
  h.api.upload = async () => { throw limite(); };
  await fila.publicarOuAgendar(args('retomada', file, { contexto }));
  await fsp.unlink(file); // O temporário é removido pelo Status Vídeo.
  h.avancar(DIA);
  h.api.upload = async ({ caminho, titulo, descricao, tags }) => {
    assert.deepEqual(await fsp.readFile(caminho), mp4);
    assert.equal(titulo, 'Vídeo teste'); assert.equal(descricao, 'Descrição preservada'); assert.deepEqual(tags, ['Teste']);
    return sucesso('retomado');
  };
  const reiniciada = h.carregar();
  await reiniciada.processarPendentes();
  const r = await reiniciada.obter({ requestId: 'retomada' });
  assert.equal(r.canal.status, 'publicado'); assert.equal(r.canal.video_id, 'retomado');
  assert.deepEqual(r.contexto, contexto);
  assert.equal(h.stats.uploads.length, 2); assert.equal(h.stats.downloads.length, 1);
  assert.equal(h.stats.downloads[0].options.redirect, 'error');
  await assert.rejects(fsp.stat(h.stats.uploads[1].caminho), { code: 'ENOENT' });
  await reiniciada.processarPendentes();
  assert.equal(h.stats.uploads.length, 2, 'O destino concluído não pode ser repetido');
});

test('nova rejeição real após o prazo abre outra janela de 24h', async t => {
  const h = harness(), fila = h.carregar(), file = await arquivo(t);
  h.api.upload = async () => { throw limite(); };
  await fila.publicarOuAgendar(args('limite-repetido', file));
  h.avancar(DIA + 60000);
  await fila.processarPendentes();
  const r = await fila.obter({ requestId: 'limite-repetido' });
  assert.equal(r.canal.proxima_tentativa_em, '2026-11-26T10:01:00.000Z');
  assert.equal(h.stats.uploads.length, 2);
});

for (const [reason, statusCode] of [['invalidTitle', 400], ['quotaExceeded', 403], ['forbidden', 403]]) {
  test(`${reason} não vira limite de uploads nem é reenviado automaticamente`, async t => {
    const h = harness(), fila = h.carregar(), file = await arquivo(t);
    h.api.upload = async () => { throw Object.assign(new Error(reason), { reason, statusCode, envioIncerto: false }); };
    const r = await fila.publicarOuAgendar(args(reason, file));
    assert.equal(r.status, 'erro'); assert.equal(h.estado().pausas.size, 0);
    h.avancar(2 * DIA); await fila.processarPendentes();
    assert.equal(h.stats.uploads.length, 1);
  });
}

test('timeout de upload fica incerto e não provoca segundo upload', async t => {
  const h = harness(), fila = h.carregar(), file = await arquivo(t);
  h.api.upload = async () => { throw Object.assign(new Error('Timeout após PUT'), { envioIncerto: true }); };
  assert.equal((await fila.publicarOuAgendar(args('timeout', file))).status, 'incerto');
  h.avancar(2 * DIA); await h.carregar().processarPendentes();
  assert.equal(h.stats.uploads.length, 1);
});

test('falha anterior ao envio não fica incerta', async t => {
  const h = harness(), fila = h.carregar(), file = await arquivo(t);
  h.api.upload = async () => { throw Object.assign(new Error('OAuth sem configuração'), { envioIncerto: false }); };
  assert.equal((await fila.publicarOuAgendar(args('config', file))).status, 'erro');
});

test('instâncias concorrentes não enviam o mesmo job duas vezes', async t => {
  const h = harness(), a = h.carregar(), b = h.carregar(), file = await arquivo(t);
  let liberar, entrou;
  const iniciada = new Promise(resolve => { entrou = resolve; });
  h.api.upload = async () => { entrou(); await new Promise(resolve => { liberar = resolve; }); return sucesso('unico'); };
  const primeira = a.publicarOuAgendar(args('concorrente', file));
  await iniciada;
  const segunda = await b.publicarOuAgendar(args('concorrente', file));
  assert.equal(segunda.status, 'processando');
  await b.processarPendentes(); assert.equal(h.stats.uploads.length, 1);
  liberar(); assert.equal((await primeira).status, 'publicado');
  assert.equal((await b.publicarOuAgendar(args('concorrente', file))).video_id, 'unico');
  assert.equal(h.stats.uploads.length, 1);
});

test('jobs concorrentes do mesmo canal aguardam e respeitam o limite do primeiro', async t => {
  const h = harness(), a = h.carregar(), b = h.carregar(), file = await arquivo(t);
  let liberar, entrou;
  const iniciada = new Promise(resolve => { entrou = resolve; });
  h.api.upload = async () => { entrou(); await new Promise(resolve => { liberar = resolve; }); throw limite(); };
  const primeira = a.publicarOuAgendar(args('canal-a', file));
  await iniciada;
  assert.equal((await b.publicarOuAgendar(args('canal-b', file))).status, 'aguardando');
  liberar(); await primeira; await b.processarPendentes();
  assert.equal((await b.obter({ requestId: 'canal-b' })).canal.status, 'aguardando_limite');
  assert.equal(h.stats.uploads.length, 1); assert.equal(h.stats.downloads.length, 0);
});

test('sucesso sem gravação no banco não é repetido após reinício', async t => {
  const h = harness(), fila = h.carregar(), file = await arquivo(t);
  h.api.upload = async () => { h.falhar('SET estado=$3'); return sucesso('ja-aceito'); };
  await assert.rejects(fila.publicarOuAgendar(args('sem-confirmacao', file)), /Falha de banco/);
  assert.equal(h.job('sem-confirmacao').estado, 'enviando');
  const reiniciada = h.carregar(); await reiniciada.processarPendentes();
  assert.equal((await reiniciada.obter({ requestId: 'sem-confirmacao' })).canal.status, 'incerto');
  assert.equal(h.stats.uploads.length, 1);
});

test('não dispara upload se não conseguir persistir o estado de envio', async t => {
  const h = harness(), fila = h.carregar(), file = await arquivo(t);
  h.falhar("SET estado='enviando'");
  await assert.rejects(fila.publicarOuAgendar(args('antes-upload', file)), /Falha de banco/);
  assert.equal(h.stats.uploads.length, 0);
});

test('snapshot completo permanece disponível após a instância ser recriada', async t => {
  const h = harness(), fila = h.carregar(), file = await arquivo(t);
  await fila.publicarOuAgendar(args('snapshot', file));
  const contexto = { request_id: 'snapshot', status_geral: 'publicado', canais: { whatsapp: { status: 'publicado', zapi: { messageId: '123' } } } };
  await fila.salvarContexto({ requestId: 'snapshot', contexto });
  assert.deepEqual((await h.carregar().obter({ requestId: 'snapshot' })).contexto, contexto);
});

test('recusa URL externa, HTTP, fora do prefixo ou com credenciais antes de enviar', async t => {
  const h = harness(), fila = h.carregar(), file = await arquivo(t);
  for (const videoUrl of ['https://evil.test/assets/status-videos/a.mp4', 'http://r2.test/assets/status-videos/a.mp4',
    'https://r2.test/assets/ofertas/a.mp4', 'https://user:pass@r2.test/assets/status-videos/a.mp4',
    'https://r2.test/assets/status-videos/../ofertas/a.mp4', 'https://r2.test/assets/status-videos/a.mp4?x=1']) {
    await assert.rejects(fila.publicarOuAgendar(args('url', file, { videoUrl })), /R2 configurado/);
  }
  assert.equal(h.stats.uploads.length, 0); assert.equal(h.estado().jobs.size, 0);
});

test('download acima do limite ou inválido não inicia outro upload', async t => {
  for (const tipo of ['grande', 'invalido']) {
    const h = harness(), fila = h.carregar(), file = await arquivo(t);
    h.api.upload = async () => { throw limite(); };
    await fila.publicarOuAgendar(args(tipo, file)); h.avancar(DIA);
    h.api.download = async () => new Response(mp4, { headers: {
      'content-type': tipo === 'invalido' ? 'text/html' : 'video/mp4',
      'content-length': String(tipo === 'grande' ? 251 * 1024 * 1024 : mp4.length),
    } });
    await fila.processarPendentes();
    assert.equal((await fila.obter({ requestId: tipo })).canal.status, 'erro');
    assert.equal(h.stats.uploads.length, 1);
  }
});

test('falha no unlock descarta a conexão em vez de devolvê-la bloqueada', async t => {
  const h = harness(), fila = h.carregar(), file = await arquivo(t);
  h.falhar('SELECT pg_advisory_unlock');
  assert.equal((await fila.publicarOuAgendar(args('unlock', file))).status, 'publicado');
  assert.equal(h.stats.descartadas, 1);
});

test('não confirma salvamento de snapshot sem publicação persistida', async () => {
  const fila = harness().carregar();
  await assert.rejects(fila.salvarContexto({ requestId: 'inexistente', contexto: {} }), /não foi encontrada/);
});

test('trocar a conta não envia pendência antiga para o novo canal', async t => {
  const h = harness(), fila = h.carregar(), file = await arquivo(t);
  h.api.upload = async () => { throw limite(); };
  await fila.publicarOuAgendar(args('canal-anterior', file));
  h.avancar(DIA); h.api.canal = 'nova-conta';
  await fila.processarPendentes();
  const r = await fila.obter({ requestId: 'canal-anterior' });
  assert.equal(r.canal.status, 'erro'); assert.match(r.canal.erro, /conta YouTube foi alterada/);
  assert.equal(h.stats.uploads.length, 1); assert.equal(h.stats.downloads.length, 0);
});

test('trocar a conta após envio interrompido preserva a confirmação incerta', async t => {
  const h = harness(), fila = h.carregar(), file = await arquivo(t);
  h.api.upload = async () => { h.falhar('SET estado=$3'); return sucesso('aceito-na-conta-antiga'); };
  await assert.rejects(fila.publicarOuAgendar(args('conta-envio-interrompido', file)), /Falha de banco/);
  h.api.canal = 'nova-conta';
  await h.carregar().processarPendentes();
  assert.equal((await fila.obter({ requestId: 'conta-envio-interrompido' })).canal.status, 'incerto');
  assert.equal(h.stats.uploads.length, 1);
});

test('conexão perdida durante upload é descartada e a retomada exige conferência', async t => {
  const h = harness(), fila = h.carregar(), file = await arquivo(t);
  h.api.upload = async () => { h.perderConexao(); return sucesso('aceito-sem-banco'); };
  await assert.rejects(fila.publicarOuAgendar(args('sem-conexao', file)), /Conexão interrompida/);
  assert.equal(h.job('sem-conexao').estado, 'enviando');
  assert.equal(h.stats.descartadas, 1);
  const reiniciada = h.carregar(); await reiniciada.processarPendentes();
  assert.equal((await reiniciada.obter({ requestId: 'sem-conexao' })).canal.status, 'incerto');
  assert.equal(h.stats.uploads.length, 1);
});

test('perder o lock durante download impede iniciar upload', async t => {
  const h = harness(), fila = h.carregar(), file = await arquivo(t);
  h.api.upload = async () => { throw limite(); };
  await fila.publicarOuAgendar(args('download-sem-lock', file)); h.avancar(DIA);
  h.api.download = async () => {
    h.perderConexao();
    return new Response(mp4, { headers: { 'content-type': 'video/mp4' } });
  };
  await fila.processarPendentes();
  assert.equal(h.stats.uploads.length, 1); assert.equal(h.stats.descartadas, 1);
  assert.equal(h.job('download-sem-lock').estado, 'preparando');
});
