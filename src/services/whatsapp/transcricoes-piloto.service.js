'use strict';

// Piloto isolado: apenas os números autorizados, sem alterar bot, sem banco e sem resposta.
const net = require('node:net');
const MAX_AUDIO = 20 * 1024 * 1024;
const MAX_REGISTROS = 60;
const MAX_FILA = 15;
const PRAZO_MS = 2 * 60 * 60 * 1000;
const registros = [];
const fila = [];
let executando = false;
let ultimoWebhookEm = null;
let ultimoAudioAutorizado = null;

function numero(valor) { return String(valor || '').replace(/\D/g, ''); }
function permitidos() {
  return new Set(String(process.env.WHATSAPP_TRANSCRICAO_NUMEROS || '')
    .split(/[;,\s]+/).map(numero).filter(n => /^\d{10,15}$/.test(n)));
}
function podeReceber(telefone) {
  const n = numero(telefone);
  return /^\d{10,15}$/.test(n) && permitidos().has(n);
}
// Apenas metadados de diagnóstico. Nunca guarda áudio, URL ou texto do webhook.
function observarWebhook(payload) {
  const agora = new Date().toISOString();
  ultimoWebhookEm = agora;
  if (!payload?.audio || !podeReceber(payload.phone)) return;
  const proprio = payload.fromMe === true &&
    numero(payload.connectedPhone) === numero(payload.phone) &&
    Boolean(numero(payload.connectedPhone));
  ultimoAudioAutorizado = {
    recebido_em: agora,
    tipo: payload.fromMe === true ? (proprio ? 'enviado_para_si' : 'enviado_para_outro') : 'recebido'
  };
}
function limpar() {
  const corte = Date.now() - PRAZO_MS;
  for (let i = registros.length - 1; i >= 0; i--) {
    if (registros[i].criadoMs < corte) registros.splice(i, 1);
  }
  if (registros.length > MAX_REGISTROS) registros.length = MAX_REGISTROS;
}
function erro(mensagem) { return new Error(mensagem); }

// Bloqueia IPs/hosts locais, HTTP e redirecionamentos. Restringe domínios do provedor.
function urlSegura(valor) {
  let u;
  try { u = new URL(valor); } catch (_) { throw erro('Link de áudio inválido.'); }
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (u.protocol !== 'https:' || u.username || u.password ||
      (u.port && u.port !== '443') || net.isIP(host) || !host.includes('.') ||
      host === 'localhost' || host.endsWith('.localhost') ||
      host.endsWith('.local') || host.endsWith('.internal')) {
    throw erro('Origem do áudio não autorizada.');
  }
  const dominios = String(process.env.WHATSAPP_TRANSCRICAO_DOMINIOS ||
    'z-api.io,amazonaws.com,cloudfront.net,whatsapp.net,r2.dev')
    .toLowerCase().split(/[;,\s]+/).map(x => x.replace(/^\./, '').trim()).filter(Boolean);
  if (!dominios.some(d => host === d || host.endsWith('.' + d))) {
    throw erro('Domínio da mídia não autorizado; confira WHATSAPP_TRANSCRICAO_DOMINIOS.');
  }
  return u.toString();
}
function formatoAudio(mime) {
  const t = String(mime || '').toLowerCase().split(';')[0].trim();
  const tipos = {
    'audio/ogg': ['audio/ogg', 'ogg'],
    'audio/opus': ['audio/ogg', 'ogg'],
    'audio/mpeg': ['audio/mpeg', 'mp3'],
    'audio/mp3': ['audio/mpeg', 'mp3'],
    'audio/mp4': ['audio/mp4', 'm4a'],
    'audio/x-m4a': ['audio/mp4', 'm4a'],
    'audio/wav': ['audio/wav', 'wav'],
    'audio/x-wav': ['audio/wav', 'wav'],
    'audio/webm': ['audio/webm', 'webm'],
    'audio/flac': ['audio/flac', 'flac']
  };
  return tipos[t] || ['audio/ogg', 'ogg'];
}
async function baixar(url) {
  const resposta = await fetch(urlSegura(url), {
    redirect: 'error',
    signal: AbortSignal.timeout(25000),
    headers: { Accept: 'audio/*,application/octet-stream' }
  });
  if (!resposta.ok || !resposta.body) throw erro('Não foi possível baixar o áudio da Z-API.');
  if (Number(resposta.headers.get('content-length') || 0) > MAX_AUDIO) {
    await resposta.body.cancel();
    throw erro('Áudio acima do limite de 20 MB.');
  }
  const partes = [];
  let total = 0;
  for await (const parte of resposta.body) {
    total += parte.length;
    if (total > MAX_AUDIO) {
      await resposta.body.cancel().catch(() => {});
      throw erro('Áudio acima do limite de 20 MB.');
    }
    partes.push(parte);
  }
  if (!total) throw erro('Arquivo de áudio vazio.');
  return Buffer.concat(partes, total);
}
async function transcrever({ url, mime }) {
  const chave = String(process.env.OPENAI_API_KEY || '').trim();
  if (!chave) throw erro('OPENAI_API_KEY não configurada no Render.');
  const bytes = await baixar(url);
  const [tipo, extensao] = formatoAudio(mime);
  const formulario = new FormData();
  formulario.append('file', new Blob([bytes], { type: tipo }), 'whatsapp.' + extensao);
  formulario.append('model', process.env.WHATSAPP_TRANSCRICAO_MODELO || 'gpt-transcribe');
  const resposta = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + chave },
    body: formulario,
    signal: AbortSignal.timeout(90000)
  });
  if (!resposta.ok) throw erro('Serviço de transcrição indisponível (HTTP ' + resposta.status + ').');
  const json = await resposta.json();
  const texto = String(json?.text || '').trim().slice(0, 10000);
  if (!texto) throw erro('Nenhuma fala foi identificada no áudio.');
  return texto;
}
async function processarFila() {
  if (executando) return;
  executando = true;
  try {
    while (fila.length) {
      const tarefa = fila.shift();
      const registro = tarefa.registro;
      registro.status = 'processando';
      try {
        registro.texto = await transcrever(tarefa);
        registro.status = 'concluida';
      } catch (falha) {
        registro.status = 'erro';
        registro.erro = falha.message || 'Falha ao transcrever áudio.';
        console.error('[Piloto transcrição WhatsApp]', registro.erro);
      }
      registro.atualizado_em = new Date().toISOString();
    }
  } finally {
    executando = false;
  }
}
function receber({ payload, dados }) {
  // Mensagens para o próprio número vêm como fromMe:true. Aceitar só se o
  // WhatsApp conectado à Z-API for exatamente o número autorizado/destinatário.
  const enviadoParaSi = dados?.direcao === 'SAIDA' && payload?.fromMe === true &&
    payload?.fromApi !== true && Boolean(numero(payload.connectedPhone)) &&
    numero(payload.connectedPhone) === numero(dados.telefone) &&
    podeReceber(payload.connectedPhone);
  const entrada = dados?.direcao === 'ENTRADA' && payload?.fromMe !== true;
  if (!dados || dados.tipo !== 'audio' || (!entrada && !enviadoParaSi) ||
      !podeReceber(dados.telefone) || payload?.isGroup || payload?.isNewsletter) return false;
  limpar();
  const id = String(dados.instancia) + ':' + String(dados.messageId);
  if (registros.some(x => x.id === id)) return false;
  const agora = Date.now();
  const registro = {
    id, telefone: numero(dados.telefone), criadoMs: agora,
    origem: enviadoParaSi ? 'enviado_para_si' : 'recebido',
    recebido_em: new Date(agora).toISOString(), atualizado_em: new Date(agora).toISOString(),
    status: 'pendente', texto: '', erro: ''
  };
  registros.unshift(registro);
  limpar();
  const url = payload?.audio?.audioUrl;
  if (!url) {
    registro.status = 'erro';
    registro.erro = 'A Z-API não forneceu o link do áudio.';
  } else if (fila.length >= MAX_FILA) {
    registro.status = 'erro';
    registro.erro = 'Fila de transcrição cheia. Envie novamente depois.';
  } else {
    fila.push({ registro, url, mime: payload.audio.mimeType });
    void processarFila().catch(falha =>
      console.error('[Piloto transcrição WhatsApp] Falha na fila:', falha.message));
  }
  return true;
}
function listar() {
  limpar();
  return {
    habilitado: permitidos().size > 0,
    ia_configurada: Boolean(String(process.env.OPENAI_API_KEY || '').trim()),
    webhook_configurado: String(process.env.ZAPI_WEBHOOK_TOKEN || '').trim().length >= 32,
    instancia_configurada: Boolean(String(process.env.ZAPI_WEBHOOK_INSTANCE_ID || '').trim() || /\/instances\/[^/]+\/token\//i.test(String(process.env.ZAPI_URL || ''))),
    ultimo_webhook_em: ultimoWebhookEm,
    ultimo_audio_autorizado: ultimoAudioAutorizado,
    registros: registros.map(({ criadoMs, ...r }) => ({ ...r }))
  };
}
module.exports = { receber, listar, podeReceber, urlSegura, formatoAudio, observarWebhook };
