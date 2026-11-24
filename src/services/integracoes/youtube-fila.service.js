'use strict';

// A fila guarda somente o destino YouTube. As outras redes nunca são chamadas
// pela retomada, e o MP4 final permanece no R2 quando o temporário é removido.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const pool = require('../../../db/connection');
const youtube = require('./youtube.service');

const MAX_BYTES = 250 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000;
const INTERVALO_MS = 60000;
let esquema;
let timer;
let cicloEmAndamento = false;

function texto(value) { return String(value ?? '').trim(); }
function erroCurto(error) {
  return texto(error?.message || error || 'Erro não informado.').replace(/https?:\/\/\S+/gi, '[URL]').slice(0, 700);
}
function semAspas(value) {
  const v = texto(value);
  return v.length > 1 && ((v[0] === '"' && v.at(-1) === '"') || (v[0] === "'" && v.at(-1) === "'"))
    ? v.slice(1, -1).trim() : v;
}
function identificadores({ requestId, origem = 'status-videos' }) {
  const id = texto(requestId), source = texto(origem);
  if (!/^[a-zA-Z0-9._:-]{1,120}$/.test(id) || !/^[a-z0-9_-]{1,40}$/.test(source)) {
    throw new Error('Identificador da publicação YouTube inválido.');
  }
  return { requestId: id, origem: source };
}
function validarUrl(videoUrl) {
  let base, url, pathname;
  try {
    base = new URL(semAspas(process.env.CLOUDFLARE_R2_PUBLIC_URL));
    url = new URL(videoUrl);
    pathname = decodeURIComponent(url.pathname);
  } catch (_) { throw new Error('URL do vídeo YouTube inválida.'); }
  const prefixo = `${decodeURIComponent(base.pathname).replace(/\/+$/, '')}/status-videos/`;
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash
      || url.protocol !== 'https:' || url.origin !== base.origin || url.username || url.password
      || url.search || url.hash || !pathname.startsWith(prefixo) || pathname.includes('\\')
      || pathname.split('/').some(p => p === '..' || p === '.') || !pathname.toLowerCase().endsWith('.mp4')) {
    throw new Error('O vídeo deve estar na pasta status-videos do R2 configurado.');
  }
  return url.href;
}

async function ensure() {
  if (!esquema) {
    esquema = (async () => {
      await pool.query(`CREATE TABLE IF NOT EXISTS youtube_upload_pausas (
        canal_chave TEXT PRIMARY KEY,
        bloqueado_ate TIMESTAMPTZ NOT NULL,
        atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS youtube_upload_fila (
        origem TEXT NOT NULL, request_id TEXT NOT NULL, canal_chave TEXT NOT NULL,
        video_url TEXT NOT NULL, metadados JSONB NOT NULL,
        estado TEXT NOT NULL DEFAULT 'pendente'
          CHECK (estado IN ('pendente','preparando','enviando','aguardando_limite','publicado','erro','incerto')),
        proxima_tentativa_em TIMESTAMPTZ,
        tentativas INTEGER NOT NULL DEFAULT 0,
        resultado JSONB, contexto JSONB, erro TEXT,
        criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (origem, request_id)
      )`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_youtube_upload_fila_pendentes
        ON youtube_upload_fila (canal_chave, estado, proxima_tentativa_em)`);
    })().catch(error => { esquema = null; throw error; });
  }
  return esquema;
}

function resultadoCanal(job) {
  if (job.estado === 'publicado') {
    return { ...job.resultado, canal: 'youtube_shorts', status: 'publicado' };
  }
  if (job.estado === 'aguardando_limite') {
    return {
      canal: 'youtube_shorts', status: 'aguardando_limite', motivo: 'uploadLimitExceeded',
      aviso: 'Limite de uploads do YouTube atingido. Nova tentativa agendada automaticamente.',
      proxima_tentativa_em: new Date(job.proxima_tentativa_em).toISOString(),
    };
  }
  if (job.estado === 'erro' || job.estado === 'incerto') {
    return { canal: 'youtube_shorts', status: job.estado, erro: job.erro || 'Envio sem confirmação.' };
  }
  return {
    canal: 'youtube_shorts', status: job.estado === 'pendente' ? 'aguardando' : 'processando',
    aviso: job.estado === 'pendente' ? 'Aguardando a vez do envio ao YouTube.' : 'Envio ao YouTube em andamento.',
  };
}
async function ler(db, { origem, requestId }) {
  const { rows } = await db.query('SELECT * FROM youtube_upload_fila WHERE origem=$1 AND request_id=$2', [origem, requestId]);
  return rows[0] || null;
}
function paraCliente(job) {
  return job ? {
    canal: resultadoCanal(job), contexto: job.contexto || null,
    criado_em: job.criado_em, atualizado_em: job.atualizado_em,
  } : null;
}
async function obter(args) {
  const ids = identificadores(args);
  await ensure();
  return paraCliente(await ler(pool, ids));
}
async function salvarContexto(args) {
  const ids = identificadores(args);
  await ensure();
  const { rowCount } = await pool.query(`UPDATE youtube_upload_fila SET contexto=$3::jsonb, atualizado_em=NOW()
    WHERE origem=$1 AND request_id=$2`, [ids.origem, ids.requestId, JSON.stringify(args.contexto)]);
  if (rowCount !== 1) throw new Error('A publicação YouTube não foi encontrada para salvar o resultado.');
}

async function baixarVideo(videoUrl, pasta) {
  const url = validarUrl(videoUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  timeout.unref?.();
  const destino = path.join(pasta, 'youtube.mp4');
  try {
    const res = await fetch(url, { redirect: 'error', signal: controller.signal });
    const tamanho = Number(res.headers.get('content-length'));
    if (!res.ok || !res.body || !/^video\/mp4\b/i.test(res.headers.get('content-type') || '') || tamanho > MAX_BYTES) {
      await res.body?.cancel?.();
      throw new Error(tamanho > MAX_BYTES ? 'O vídeo no R2 ultrapassa 250 MB.' : `Não foi possível recuperar o MP4 no R2 (HTTP ${res.status}).`);
    }
    let bytes = 0;
    const limite = new Transform({ transform(chunk, _encoding, callback) {
      bytes += chunk.length;
      callback(bytes > MAX_BYTES ? new Error('A transferência do vídeo ultrapassou 250 MB.') : null, chunk);
    } });
    await pipeline(Readable.fromWeb(res.body), limite, fs.createWriteStream(destino, { flags: 'wx' }), { signal: controller.signal });
    if (!bytes || (tamanho > 0 && tamanho !== bytes)) throw new Error('Arquivo do R2 vazio ou transferência incompleta.');
    return destino;
  } catch (error) {
    if (controller.signal.aborted) throw new Error('Tempo limite ao recuperar o vídeo no R2.');
    throw error;
  } finally { clearTimeout(timeout); }
}

async function marcar(db, ids, estado, { erro = null, resultado = null } = {}) {
  const { rows } = await db.query(`UPDATE youtube_upload_fila
    SET estado=$3, erro=$4, resultado=$5::jsonb, proxima_tentativa_em=NULL, atualizado_em=NOW()
    WHERE origem=$1 AND request_id=$2 RETURNING *`, [ids.origem, ids.requestId, estado, erro, JSON.stringify(resultado)]);
  return rows[0];
}
async function adiar(db, ids, ate) {
  const { rows } = await db.query(`UPDATE youtube_upload_fila
    SET estado='aguardando_limite', proxima_tentativa_em=$3, erro=NULL, atualizado_em=NOW()
    WHERE origem=$1 AND request_id=$2 RETURNING *`, [ids.origem, ids.requestId, ate]);
  return rows[0];
}

async function processar(ids, caminhoLocal) {
  const anterior = await ler(pool, ids);
  if (!anterior) throw new Error('Publicação YouTube não encontrada.');
  if (['publicado', 'erro', 'incerto'].includes(anterior.estado)) return resultadoCanal(anterior);

  const client = await pool.connect();
  let locked = false, descarte = false, pasta, erroConexao;
  const aoFalharConexao = error => { erroConexao = error; descarte = true; };
  client.on?.('error', aoFalharConexao);
  try {
    // O bloqueio pertence à conexão, sem transação aberta durante a rede. Todas
    // as instâncias e todos os jobs do mesmo canal passam pelo mesmo bloqueio.
    const lock = await client.query('SELECT pg_try_advisory_lock(74105319, hashtext($1)) AS locked', [anterior.canal_chave]);
    locked = Boolean(lock.rows[0]?.locked);
    if (!locked) return resultadoCanal(await ler(client, ids));
    let job = await ler(client, ids);
    if (['publicado', 'erro', 'incerto'].includes(job.estado)) return resultadoCanal(job);
    if (job.estado === 'enviando') {
      // Só chegamos aqui com o lock livre: o processo anterior saiu sem gravar
      // a resposta. Reenviar poderia duplicar um vídeo já aceito pelo YouTube.
      return resultadoCanal(await marcar(client, ids, 'incerto', {
        erro: 'Envio interrompido sem confirmação. Confira o canal antes de repetir a publicação.',
      }));
    }
    if (job.canal_chave !== youtube.identificarCanal()) {
      return resultadoCanal(await marcar(client, ids, 'erro', { erro: 'A conta YouTube foi alterada. O vídeo pendente não foi enviado para outra conta.' }));
    }
    const pausa = await client.query(`SELECT bloqueado_ate FROM youtube_upload_pausas
      WHERE canal_chave=$1 AND bloqueado_ate>NOW()`, [job.canal_chave]);
    if (pausa.rows[0]) return resultadoCanal(await adiar(client, ids, pausa.rows[0].bloqueado_ate));
    const vencido = await client.query(`SELECT 1 FROM youtube_upload_fila
      WHERE origem=$1 AND request_id=$2 AND (proxima_tentativa_em IS NULL OR proxima_tentativa_em<=NOW())`, [ids.origem, ids.requestId]);
    if (!vencido.rows.length) return resultadoCanal(job);

    await marcar(client, ids, 'preparando');
    let caminho = caminhoLocal, resultado, falha;
    try {
      if (!caminho) {
        pasta = await fsp.mkdtemp(path.join(os.tmpdir(), 'ajr-youtube-fila-'));
        caminho = await baixarVideo(job.video_url, pasta);
      }
      const stat = await fsp.stat(caminho);
      if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_BYTES) throw new Error('Arquivo YouTube ausente, vazio ou acima de 250 MB.');
    } catch (error) {
      return resultadoCanal(await marcar(client, ids, 'erro', { erro: erroCurto(error) }));
    }

    // Perder a conexão também perde o advisory lock. Não iniciar transmissão
    // com uma sessão que deixou de garantir a exclusividade do canal.
    if (erroConexao) throw erroConexao;
    // Persistir ANTES de qualquer chamada que possa transmitir o vídeo.
    await client.query(`UPDATE youtube_upload_fila SET estado='enviando', tentativas=tentativas+1, atualizado_em=NOW()
      WHERE origem=$1 AND request_id=$2`, [ids.origem, ids.requestId]);
    if (erroConexao) throw erroConexao;
    try { resultado = await youtube.publicarShort({ caminho, ...job.metadados }); }
    catch (error) { falha = error; }
    if (erroConexao) throw erroConexao; // Ficará incerto, sem novo upload, na retomada.

    if (!falha) return resultadoCanal(await marcar(client, ids, 'publicado', { resultado }));
    if (youtube.limiteUploadAtingido(falha)) {
      // Só uma rejeição REAL estende a pausa; ler/percorrer a fila não altera
      // bloqueado_ate. Salvar prazo e job é uma única transação curta.
      await client.query('BEGIN');
      try {
        const pausaNova = await client.query(`INSERT INTO youtube_upload_pausas (canal_chave, bloqueado_ate)
          VALUES ($1, NOW()+INTERVAL '24 hours') ON CONFLICT (canal_chave) DO UPDATE
          SET bloqueado_ate=EXCLUDED.bloqueado_ate, atualizado_em=NOW() RETURNING bloqueado_ate`, [job.canal_chave]);
        job = await adiar(client, ids, pausaNova.rows[0].bloqueado_ate);
        await client.query('COMMIT');
      } catch (error) {
        try { await client.query('ROLLBACK'); } catch (_) { descarte = true; }
        throw error;
      }
      return resultadoCanal(job);
    }
    const statusHttp = Number(falha.statusCode || falha.httpStatus || falha.status || 0);
    const incerto = typeof falha.envioIncerto === 'boolean' ? falha.envioIncerto : !(statusHttp >= 400 && statusHttp < 500 && statusHttp !== 408);
    return resultadoCanal(await marcar(client, ids, incerto ? 'incerto' : 'erro', { erro: erroCurto(falha) }));
  } finally {
    if (pasta) await fsp.rm(pasta, { recursive: true, force: true }).catch(() => {});
    if (locked && !erroConexao) {
      try { await client.query('SELECT pg_advisory_unlock(74105319, hashtext($1))', [anterior.canal_chave]); }
      catch (_) { descarte = true; }
    }
    // Nunca devolver ao pool uma sessão cujo advisory lock pode continuar ativo.
    try { client.release(descarte ? new Error('Descartar conexão da fila YouTube.') : undefined); }
    finally { client.removeListener?.('error', aoFalharConexao); }
  }
}

async function publicarOuAgendar(args) {
  const ids = identificadores(args);
  const videoUrl = validarUrl(args.videoUrl);
  const metadados = { titulo: texto(args.titulo).slice(0, 100), descricao: texto(args.descricao).slice(0, 5000),
    tags: Array.isArray(args.tags) ? args.tags.slice(0, 30).map(String) : [] };
  await ensure();
  const inserted = await pool.query(`INSERT INTO youtube_upload_fila
    (origem,request_id,canal_chave,video_url,metadados,contexto)
    VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb) ON CONFLICT (origem,request_id) DO NOTHING RETURNING request_id`,
  [ids.origem, ids.requestId, youtube.identificarCanal(), videoUrl, JSON.stringify(metadados), JSON.stringify(args.contexto || null)]);
  return { ...await processar(ids, inserted.rowCount ? args.caminho : undefined), repetida: !inserted.rowCount };
}

async function processarPendentes() {
  if (cicloEmAndamento) return;
  cicloEmAndamento = true;
  try {
    await ensure();
    const { rows } = await pool.query(`SELECT origem,request_id FROM youtube_upload_fila
      WHERE estado IN ('pendente','preparando','enviando','aguardando_limite')
        AND (proxima_tentativa_em IS NULL OR proxima_tentativa_em<=NOW())
      ORDER BY criado_em LIMIT 20`);
    for (const row of rows) {
      try { await processar({ origem: row.origem, requestId: row.request_id }); }
      catch (error) { console.error('[YouTube fila] Falha ao retomar:', erroCurto(error)); }
    }
  } finally { cicloEmAndamento = false; }
}
function iniciar() {
  if (timer) return;
  const executar = () => processarPendentes().catch(error => console.error('[YouTube fila] Falha no ciclo:', erroCurto(error)));
  timer = setInterval(executar, INTERVALO_MS);
  timer.unref?.();
  executar();
}

module.exports = { publicarOuAgendar, salvarContexto, obter, iniciar, processarPendentes };
