'use strict';

// Republicador isolado: não altera os publicadores existentes.
const crypto = require('crypto');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const pool = require('../../../db/connection');
const catalogo = require('./republicador-youtube.catalogo');
const r2 = require('./republicador-youtube.r2');
const instagram = require('../integracoes/instagram.service');
const facebook = require('../integracoes/facebook.service');
const zapi = require('../integracoes/zapi.service');
const videoOverlay = require('../status-videos/videoOverlay.service');
const localDownloader = require('./republicador-youtube.local');

const MAX_BYTES = 250 * 1024 * 1024;
const MAX_SEGUNDOS = 660; // até 12 Stories/Status de 55s
const SEGUNDOS_POR_PARTE = 55;
const HORAS_RETENCAO_ERRO = 24;
const MINUTOS_RETENCAO_SUCESSO = 10; // margem para a Meta terminar de buscar o arquivo
let esquema = null;
let fila = Promise.resolve();
let limpezaEmAndamento = false;

function erroCurto(err) { return String(err?.message || err || 'Erro desconhecido').slice(0, 700); }
function seguroId(id) { if (!/^[a-f0-9-]{36}$/i.test(String(id || ''))) throw new Error('ID da solicitação inválido.'); return id; }
function validarVideoId(id) { if (!/^[A-Za-z0-9_-]{11}$/.test(String(id || ''))) throw new Error('ID de vídeo inválido.'); return id; }
function dataLimpeza(minutos) { return new Date(Date.now() + minutos * 60000).toISOString(); }
function ffmpegPath() { return process.env.FFMPEG_PATH || require('ffmpeg-static'); }

async function ensure() {
  if (!esquema) {
    esquema = (async () => {
      await pool.query(`CREATE TABLE IF NOT EXISTS marketing_republicador_youtube (
        id UUID PRIMARY KEY, youtube_video_id VARCHAR(11) NOT NULL, titulo TEXT NOT NULL,
        modo VARCHAR(12) NOT NULL CHECK (modo IN ('teste','publicar')),
        estado VARCHAR(25) NOT NULL DEFAULT 'aguardando', etapa TEXT NOT NULL DEFAULT 'Na fila',
        canais JSONB NOT NULL DEFAULT '{}'::jsonb,
        partes JSONB NOT NULL DEFAULT '{}'::jsonb,
        arquivos JSONB NOT NULL DEFAULT '[]'::jsonb,
        erro TEXT, criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(), r2_apagar_em TIMESTAMPTZ
      )`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_marketing_republicador_youtube_criado
                        ON marketing_republicador_youtube (criado_em DESC)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_marketing_republicador_youtube_limpeza
                        ON marketing_republicador_youtube (r2_apagar_em) WHERE r2_apagar_em IS NOT NULL`);
    })().catch(e => { esquema = null; throw e; });
  }
  await esquema;
}

async function obter(id) {
  await ensure();
  const { rows } = await pool.query('SELECT * FROM marketing_republicador_youtube WHERE id = $1', [seguroId(id)]);
  return rows[0] || null;
}

function paraCliente(job) {
  if (!job) return null;
  return {
    id: job.id, youtube_video_id: job.youtube_video_id, titulo: job.titulo, modo: job.modo,
    estado: job.estado, etapa: job.etapa, canais: job.canais || {}, erro: job.erro || null,
    total_partes: job.partes?.clips?.length || 0,
    possui_arquivo_temporario: (job.arquivos || []).length > 0,
    criado_em: job.criado_em, atualizado_em: job.atualizado_em,
    r2_apagar_em: job.r2_apagar_em,
  };
}

async function salvar(id, changes) {
  const fields = []; const vals = [];
  for (const [k, v] of Object.entries(changes)) {
    if (!['estado','etapa','canais','partes','arquivos','erro','r2_apagar_em'].includes(k)) throw new Error('Coluna inválida');
    vals.push(['canais','partes','arquivos'].includes(k) ? JSON.stringify(v) : v);
    fields.push(`${k} = $${vals.length}${['canais','partes','arquivos'].includes(k) ? '::jsonb' : ''}`);
  }
  vals.push(id);
  await pool.query(`UPDATE marketing_republicador_youtube SET ${fields.join(', ')}, atualizado_em = NOW() WHERE id = $${vals.length}`, vals);
}

async function iniciar(videoId, modo, requestId) {
  validarVideoId(videoId);
  if (!['teste','publicar'].includes(modo)) throw new Error('Modo inválido.');
  await ensure();
  const id = requestId ? seguroId(requestId) : crypto.randomUUID();
  const anterior = await obter(id);
  if (anterior) {
    if (anterior.youtube_video_id !== videoId || anterior.modo !== modo) throw new Error('Identificador já utilizado para outro vídeo.');
    return paraCliente(anterior);
  }
  // Duplo clique/nova aba: não gerar outra publicação enquanto existir uma pendente.
  if (modo === 'publicar') {
    const { rows } = await pool.query(`SELECT * FROM marketing_republicador_youtube
      WHERE youtube_video_id=$1 AND modo='publicar'
        AND estado IN ('aguardando','baixando','preparando','publicando','parcial','erro','interrompido')
      ORDER BY criado_em DESC LIMIT 1`, [videoId]);
    if (rows[0]) return paraCliente(rows[0]);
  }
  // Só permite vídeos pertencentes ao canal definido para a Alumínio JR.
  const video = await catalogo.validarVideoProprio(videoId);
  const channels = modo === 'publicar' ? {
    whatsapp_status: { status: 'pendente', partes: {} },
    instagram_story: { status: 'pendente', partes: {} },
    facebook_feed: { status: 'pendente' },
  } : {};
  const inserted = await pool.query(`INSERT INTO marketing_republicador_youtube
    (id,youtube_video_id,titulo,modo,canais) VALUES ($1,$2,$3,$4,$5::jsonb)
    ON CONFLICT (id) DO NOTHING RETURNING id`, [id, videoId, video.titulo, modo, JSON.stringify(channels)]);
  if (inserted.rowCount) colocarNaFila(id);
  return paraCliente(await obter(id));
}

async function historico() {
  await ensure();
  const { rows } = await pool.query('SELECT * FROM marketing_republicador_youtube ORDER BY criado_em DESC LIMIT 35');
  return rows.map(paraCliente);
}

async function retry(id) {
  await ensure();
  const job = await obter(id);
  if (!job || job.modo !== 'publicar') throw new Error('Publicação não encontrada.');
  if (!['parcial','erro','interrompido'].includes(job.estado)) throw new Error('Essa publicação não está disponível para repetição.');
  const { rowCount } = await pool.query(`UPDATE marketing_republicador_youtube
    SET estado='aguardando', etapa='Retentativa apenas das redes pendentes', erro=NULL,
      atualizado_em=NOW(), r2_apagar_em=NULL
    WHERE id=$1 AND estado IN ('parcial','erro','interrompido')`, [id]);
  if (!rowCount) throw new Error('Publicação já está sendo processada.');
  colocarNaFila(id);
  return paraCliente(await obter(id));
}

function processarFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath(), args, { stdio: ['ignore','ignore','pipe'], windowsHide: true });
    let stderr = '';
    const timeout = setTimeout(() => child.kill('SIGKILL'), 240000);
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-5000); });
    child.on('error', e => { clearTimeout(timeout); reject(e); });
    child.on('close', code => {
      clearTimeout(timeout);
      if (code === 0) return resolve(stderr);
      reject(new Error(`FFmpeg falhou (${code}): ${stderr.slice(-650)}`));
    });
  });
}

async function duracao(caminho) {
  const txt = await new Promise((resolve, reject) => {
    const c = spawn(ffmpegPath(), ['-hide_banner','-i',caminho], { stdio: ['ignore','ignore','pipe'] });
    let s = '';
    c.stderr.on('data', x => { s = (s + x.toString()).slice(-6000); });
    c.on('error', reject);
    c.on('close', () => resolve(s));
  });
  const match = txt.match(/Duration:\s*(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/i);
  if (!match) throw new Error('Não foi possível identificar a duração do vídeo baixado.');
  const t = Number(match[1])*3600 + Number(match[2])*60 + Number(match[3]);
  if (t < 3 || t > MAX_SEGUNDOS) throw new Error(`Vídeo com ${t.toFixed(1)}s. Intervalo admitido: 3 a ${MAX_SEGUNDOS}s.`);
  return t;
}

async function preparar(job) {
  if (job.partes?.clips?.length && job.partes?.original?.url && (job.arquivos || []).length) {
    return job.partes; // Reutiliza mídia no R2 após falha; não baixa de novo.
  }
  // Se houve interrupção durante a preparação, descartar objetos incompletos.
  if ((job.arquivos || []).length && !job.partes?.clips?.length) {
    for (const key of job.arquivos) await r2.excluir(key);
    await salvar(job.id, { arquivos: [], partes: {} });
  }
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ajr-republicador-'));
  const keys = [];
  const partes = { original: null, clips: [] };
  try {
    await salvar(job.id, { estado: 'baixando', etapa: 'Iniciando download pelo Node local' });
    const original = await localDownloader.baixarVideo(job.youtube_video_id, dir,
      etapa => salvar(job.id, { etapa }));
    const segundos = await duracao(original);
    await salvar(job.id, { estado: 'preparando', etapa: 'Enviando vídeo original ao Cloudflare R2' });
    const subido = await r2.upload(original, `${job.id}-original.mp4`, job.id, 'original');
    keys.push(subido.key);
    partes.original = { url: subido.url };
    await salvar(job.id, { arquivos: [...keys] });
    const total = Math.ceil(segundos / SEGUNDOS_POR_PARTE);
    // Distribui a duração uniformemente para evitar um último Story de 0,1 s.
    const duracaoParte = segundos / total;
    for (let i=0; i<total; i++) {
      const trecho = i === total-1 ? segundos - i*duracaoParte : duracaoParte;
      const destino = path.join(dir, `parte-${i+1}.mp4`);
      await salvar(job.id, { etapa: `Adaptando parte ${i+1} de ${total} para Stories/Status` });
      await processarFfmpeg(['-y','-threads','1','-ss',String(i*duracaoParte),'-i',original,
        '-t',String(trecho),'-map','0:v:0','-map','0:a?',
        '-vf','scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2,setsar=1',
        '-c:v','libx264','-preset','ultrafast','-threads','1','-crf','25',
        '-pix_fmt','yuv420p','-c:a','aac','-b:a','96k','-movflags','+faststart',destino]);
      const sub = await r2.upload(destino, `${job.id}-parte-${i+1}.mp4`, job.id, i+1);
      keys.push(sub.key);
      await salvar(job.id, { arquivos: [...keys] });
      const statusVideo = await videoOverlay.gerarVideoWhatsapp({ caminhoEntrada: destino, duracaoSegundos: trecho });
      let whatsappUrl = sub.url;
      try {
        if (statusVideo.temporario) {
          const c = await r2.upload(statusVideo.caminho, `${job.id}-zap-${i+1}.mp4`, job.id, `zap-${i+1}`);
          keys.push(c.key);
          await salvar(job.id, { arquivos: [...keys] });
          whatsappUrl = c.url;
        }
      } finally {
        if (statusVideo.temporario) await fsp.unlink(statusVideo.caminho).catch(() => {});
      }
      partes.clips.push({ url: sub.url, whatsapp_url: whatsappUrl, segundos: Number(trecho.toFixed(2)) });
    }
    await salvar(job.id, { partes, arquivos: keys, etapa: 'Arquivos prontos para as redes sociais' });
    return partes;
  } finally {
    await fsp.rm(dir,{recursive:true,force:true}).catch(()=>{});
  }
}

async function publicarCanais(job, partes) {
  const canais = job.canais || {};
  const executarPartes = async (nome, titulo, urlCampo, enviar) => {
    const atual = canais[nome] || { status: 'pendente', partes: {} };
    if (atual.status === 'publicado') return;
    atual.partes ||= {};
    canais[nome] = atual;
    atual.status = 'processando';
    await salvar(job.id, { estado:'publicando', etapa: titulo, canais });
    for (let i=0; i<partes.clips.length; i++) {
      if (atual.partes[i]?.status === 'publicado') continue;
      try {
        const resultado = await enviar(partes.clips[i][urlCampo]);
        atual.partes[i] = { status: 'publicado', id: resultado?.media_id || resultado?.zapi?.messageId || null };
        atual.erro = null;
        await salvar(job.id, { etapa: `${titulo}: ${i+1}/${partes.clips.length} aceitas`, canais });
      } catch (e) {
        atual.status = 'erro'; atual.erro = erroCurto(e);
        await salvar(job.id, { canais });
        return;
      }
    }
    atual.status = 'publicado';
    await salvar(job.id, { canais });
  };
  // Processa sequencialmente para evitar pico de memória e rate limit no Render.
  await executarPartes('whatsapp_status', 'Publicando no WhatsApp Status', 'whatsapp_url',
    url => zapi.enviarVideoStatus({ video: url }));
  await executarPartes('instagram_story', 'Publicando no Instagram Stories', 'url',
    url => instagram.publicarStoryVideo({ videoUrl: url }));
  const fb = canais.facebook_feed || { status:'pendente' };
  canais.facebook_feed = fb;
  if (fb.status !== 'publicado') {
    fb.status = 'processando';
    await salvar(job.id, { etapa:'Publicando vídeo no Facebook Feed', canais });
    try {
      const response = await facebook.publicarFeedVideo({
        videoUrl: partes.original.url,
        title: job.titulo.slice(0, 150),
        message: `${job.titulo}\n\nAlumínio JR\nhttps://www.youtube.com/watch?v=${job.youtube_video_id}`,
      });
      fb.status = 'publicado'; fb.post_id = response.post_id || response.video_id; delete fb.erro;
    } catch (e) { fb.status = 'erro'; fb.erro = erroCurto(e); }
    await salvar(job.id, { canais });
  }
  return canais;
}

async function trabalhar(id) {
  let job = await obter(id);
  if (!job || job.estado !== 'aguardando') return;
  try {
    if (job.modo === 'teste') {
      await preparar(job);
      await salvar(id,{ estado:'concluido', etapa:'Download e upload R2 concluídos. Nenhuma rede recebeu publicação.',
        r2_apagar_em:dataLimpeza(5) });
      return;
    }
    const partes = await preparar(job);
    job = await obter(id);
    const canais = await publicarCanais(job, partes);
    const success = ['whatsapp_status','instagram_story','facebook_feed'].every(k => canais[k]?.status === 'publicado');
    await salvar(id,{ estado:success?'concluido':'parcial',
      etapa:success?'Três redes aceitaram o vídeo. Aguardando limpeza do R2.':'Falha em uma ou mais redes; use Repetir pendentes.',
      erro:success?null:Object.entries(canais).filter(([,v])=>v.status==='erro').map(([k,v])=>`${k}: ${v.erro}`).join(' | ').slice(0,700),
      r2_apagar_em:dataLimpeza(success?MINUTOS_RETENCAO_SUCESSO:HORAS_RETENCAO_ERRO*60) });
  } catch (e) {
    console.error('[Republicador YouTube] Falha no job:',id, erroCurto(e));
    await salvar(id,{ estado:'erro', etapa:'Falha ao preparar ou enviar mídia', erro:erroCurto(e),
      r2_apagar_em:dataLimpeza(HORAS_RETENCAO_ERRO*60) }).catch(console.error);
  }
}

function colocarNaFila(id) {
  fila = fila.catch(()=>{}).then(()=>trabalhar(id));
  fila.catch(e=>console.error('[Republicador YouTube] Erro de fila:',erroCurto(e)));
}

async function limparVencidos() {
  if (limpezaEmAndamento) return;
  limpezaEmAndamento = true;
  try {
    await ensure();
    const { rows } = await pool.query(`SELECT id,arquivos,estado FROM marketing_republicador_youtube
      WHERE r2_apagar_em <= NOW() ORDER BY r2_apagar_em LIMIT 20`);
    for (const row of rows) {
      try {
        for (const key of row.arquivos || []) await r2.excluir(key);
        await salvar(row.id,{ arquivos:[], partes:{}, r2_apagar_em:null,
          etapa:row.estado==='concluido'?'Finalizado; arquivo temporário excluído do R2':'Arquivo temporário expirado e excluído do R2' });
      } catch(e) { console.error('[Republicador YouTube] Limpeza R2 pendente:', row.id, erroCurto(e)); }
    }
  } catch(e) { console.error('[Republicador YouTube] Limpeza:',erroCurto(e)); }
  finally { limpezaEmAndamento = false; }
}

function inicializar() {
  ensure().then(async()=>{
    // Não republicar automaticamente após queda: resposta anterior da rede pode ser incerta.
    await pool.query(`UPDATE marketing_republicador_youtube
      SET estado='interrompido', etapa='Render reiniciou; verificar publicações anteriores antes de repetir',
        atualizado_em=NOW(), r2_apagar_em=NOW()+INTERVAL '24 hours'
      WHERE estado IN ('aguardando','baixando','preparando','publicando')`);
    await limparVencidos();
  }).catch(e=>console.warn('[Republicador YouTube] Schema:',erroCurto(e)));
  const timer = setInterval(limparVencidos, 60000);
  timer.unref?.();
}

async function diagnostico() {
  const e = process.env;
  return { youtube_api_key: Boolean(e.YOUTUBE_API_KEY),
    youtube_channel_id: Boolean(e.YOUTUBE_CHANNEL_ID),
    oauth_youtube: Boolean(e.YOUTUBE_CLIENT_ID && e.YOUTUBE_CLIENT_SECRET && e.YOUTUBE_REFRESH_TOKEN),
    r2: Boolean(e.CLOUDFLARE_R2_ACCOUNT_ID && e.CLOUDFLARE_R2_BUCKET && e.CLOUDFLARE_R2_PUBLIC_URL),
    instagram: instagram.diagnosticarConfiguracao(), facebook: facebook.diagnosticarConfiguracao(),
    download: 'yt-dlp no Node local', node_local: await localDownloader.diagnostico(),
    armazenamento: 'R2 temporário; PostgreSQL apenas metadados',
    observacao: 'Sucesso significa aceite pelas APIs; não confirmação de visualização pública.' };
}

module.exports = { inicializar, iniciar, retry, obter, paraCliente, historico, diagnostico, listar:catalogo.listar };
