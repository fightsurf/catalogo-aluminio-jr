'use strict';

// Render -> Node local através do Cloudflare Tunnel já existente.
// URLs de vídeos nunca são aceitas do navegador; somente ID validado.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const MAX_BYTES = 250 * 1024 * 1024;
const API_PREFIX = '/api/republicador-youtube';
const INTERVALO_MS = 2500;
const LIMITE_ESPERA_MS = 9 * 60 * 1000;

function configuracao() {
  const raw = String(process.env.LEGADO_BRIDGE_URL || '').trim();
  const apiKey = String(process.env.LEGADO_BRIDGE_API_KEY || '').trim();
  if (!raw || !apiKey) throw new Error('Configure LEGADO_BRIDGE_URL e LEGADO_BRIDGE_API_KEY no Render para o download local.');
  let url;
  try { url = new URL(raw); } catch (_) { throw new Error('LEGADO_BRIDGE_URL inválida.'); }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.search || url.hash ||
      !['/',''].includes(url.pathname)) {
    throw new Error('LEGADO_BRIDGE_URL deve ser HTTPS e apontar à raiz do túnel, sem caminho nem parâmetros.');
  }
  return { origin: url.origin, apiKey };
}
function erroCurto(s) { return String(s || 'Erro desconhecido').replace(/https?:\/\/\S+/gi,'[URL]').slice(0,520); }
async function requisicao(config, pathSuffix, options={}, timeout=18000) {
  const ac=new AbortController();
  const timer=setTimeout(()=>ac.abort(),timeout);
  try {
    const response=await fetch(config.origin+API_PREFIX+pathSuffix,{
      ...options,
      redirect:'error', // Evita encaminhar x-api-key para outro domínio.
      signal:ac.signal,
      headers:{'x-api-key':config.apiKey,...(options.body?{'content-type':'application/json'}:{})}
    });
    if (!response.ok) {
      const txt=await response.text().catch(()=>'');
      let message='';
      try {const data=JSON.parse(txt);message=data.message||data.erro||'';}catch(_){}
      throw new Error('API local HTTP '+response.status+': '+erroCurto(message||response.statusText));
    }
    return response;
  } catch(e) {
    if (ac.signal.aborted) throw new Error('Tempo limite ao conectar com o Node local.');
    throw e;
  } finally {clearTimeout(timer);}
}
async function json(config,suffix,options={},timeout=18000) {
  const response=await requisicao(config,suffix,options,timeout);
  const body=await response.json().catch(()=>null);
  if (!body || body.success!==true || !body.data) throw new Error('Resposta inválida da API local.');
  return body.data;
}
function jobValido(job,videoId) {
  if (!job || !/^[a-f0-9-]{36}$/i.test(String(job.id||'')) || job.video_id!==videoId ||
      !['aguardando','consultando','baixando','pronto','erro'].includes(job.estado)) {
    throw new Error('API local retornou tarefa/estado inválido.');
  }
  return job;
}
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function salvarArquivo(config,jobId,pasta) {
  const res=await requisicao(config,'/jobs/'+jobId+'/arquivo',{},300000);
  const length=Number(res.headers.get('content-length'));
  if (Number.isFinite(length) && length>MAX_BYTES) {
    await res.body?.cancel?.();
    throw new Error('Arquivo maior que 250 MB.');
  }
  if (!res.body || !/^video\/mp4\b/i.test(res.headers.get('content-type')||'')) {
    await res.body?.cancel?.();
    throw new Error('Node local não retornou um vídeo MP4.');
  }
  const dest=path.join(pasta,'original.mp4');
  let bytes=0;
  const limite=new Transform({transform(chunk,_enc,done){
    bytes+=chunk.length;
    done(bytes>MAX_BYTES?new Error('Transferência ultrapassou 250 MB.'):null,chunk);
  }});
  try {
    await pipeline(Readable.fromWeb(res.body),limite,fs.createWriteStream(dest,{flags:'wx'}),
      {signal:AbortSignal.timeout(300000)});
    if (bytes===0) throw new Error('O MP4 recebido está vazio.');
    if (Number.isFinite(length) && length>0 && bytes!==length) {
      throw new Error('Transferência incompleta; tamanho do MP4 diferente do informado.');
    }
    const fh=await fsp.open(dest,'r');
    try {
      const h=Buffer.alloc(12);
      if ((await fh.read(h,0,12,0)).bytesRead<12 || h.toString('ascii',4,8)!=='ftyp')
        throw new Error('O arquivo retornado não parece ser MP4.');
    } finally {await fh.close();}
    return dest;
  } catch(e) {
    await fsp.unlink(dest).catch(()=>{});
    throw e;
  }
}
async function baixarVideo(videoId,pasta,atualizarEtapa=async()=>{}) {
  if (!/^[A-Za-z0-9_-]{11}$/.test(String(videoId||''))) throw new Error('ID do YouTube inválido.');
  const config=configuracao();
  await atualizarEtapa('Solicitando download ao computador da fábrica');
  const iniciado=jobValido(await json(config,'/jobs',{
    method:'POST',body:JSON.stringify({video_id:videoId})
  }),videoId);
  const limite=Date.now()+LIMITE_ESPERA_MS;
  let etapaAnterior='';
  while (Date.now()<limite) {
    const job=jobValido(await json(config,'/jobs/'+iniciado.id),videoId);
    if (job.estado==='erro') throw new Error('Download local: '+erroCurto(job.erro||job.etapa));
    if (job.estado==='pronto') {
      if (!Number.isFinite(Number(job.bytes)) || Number(job.bytes)<=0 || Number(job.bytes)>MAX_BYTES)
        throw new Error('Arquivo local ausente ou acima de 250 MB.');
      await atualizarEtapa('Transferindo MP4 do computador local para o Render');
      return salvarArquivo(config,iniciado.id,pasta);
    }
    if (job.estado!==etapaAnterior) {
      etapaAnterior=job.estado;
      await atualizarEtapa('Computador da fábrica: '+erroCurto(job.etapa||job.estado));
    }
    await delay(INTERVALO_MS);
  }
  throw new Error('Tempo limite de 9 minutos aguardando download local.');
}
async function diagnostico() {
  let config;
  try {config=configuracao();}
  catch(e) {return {configurado:false,acessivel:false,detalhe:erroCurto(e.message)};}
  try {
    const d=await json(config,'/diagnostico',{},10000);
    return {configurado:true,acessivel:true,node:d.node,yt_dlp:d.yt_dlp,ffmpeg:d.ffmpeg,
      canal_configurado:Boolean(d.youtube_channel_id_configurado),
      downloads_em_andamento:d.downloads_em_andamento};
  } catch(e) {return {configurado:true,acessivel:false,detalhe:erroCurto(e.message)};}
}
module.exports={baixarVideo,diagnostico};
