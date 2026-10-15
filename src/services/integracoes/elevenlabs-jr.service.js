'use strict';

// Adaptador isolado: ElevenLabs Text-to-Speech -> MP3 -> Z-API.
// Todos os segredos permanecem SOMENTE no servidor Render.
const zapi = require('./zapi.service');
const { randomUUID } = require('crypto');
const BASE = 'https://api.elevenlabs.io/v1';
const MODEL = 'eleven_flash_v2_5'; // Suporta português e reduz consumo/latência.
const MAX_TEXT = 1000;
const MAX_AUDIO = 5 * 1024 * 1024;
const PREVIEW_TTL_MS = 10 * 60 * 1000;
const MAX_PREVIEWS = 8;
const previews = new Map();

function configurar() {
  return {
    elevenlabs: Boolean(String(process.env.ELEVENLABS_API_KEY || '').trim()),
    telefoneTeste: Boolean(telefonePermitido()),
    vozPadrao: String(process.env.ELEVENLABS_VOICE_ID || '').trim(),
    modelo: MODEL,
    limiteCaracteres: MAX_TEXT,
    somenteTeste: false
  };
}
function telefonePermitido() {
  const tel = zapi.normalizarTelefone(process.env.ELEVENLABS_TEST_PHONE || '');
  return /^55\d{10,11}$/.test(tel) ? tel : '';
}
function validarDestino(telefone) {
  const entrada = String(telefone == null ? '' : telefone).trim();
  if (entrada && !/^[+()\d\s.-]{10,30}$/.test(entrada)) {
    const e = new Error('Telefone inválido. Informe DDD e número, com ou sem 55.'); e.status=400; throw e;
  }
  let digitos = zapi.normalizarTelefone(entrada);
  if (!digitos) digitos = telefonePermitido(); // Compatibilidade com o teste anterior
  else if (/^\d{10,11}$/.test(digitos)) digitos = `55${digitos}`;
  if (!/^55[1-9]\d{9,10}$/.test(digitos)) {
    const e = new Error('Informe um número brasileiro válido: 55 + DDD + telefone.'); e.status=400; throw e;
  }
  return digitos;
}
function limparPreviews() {
  const agora = Date.now();
  for (const [id, item] of previews) if (item.expira <= agora) previews.delete(id);
  while (previews.size >= MAX_PREVIEWS) previews.delete(previews.keys().next().value);
}
function salvarPreview(audio, usuario) {
  limparPreviews();
  const id = randomUUID();
  previews.set(id, {audio, usuario: String(usuario || ''), expira:Date.now()+PREVIEW_TTL_MS});
  return id;
}
function obterPreview(id, usuario) {
  limparPreviews();
  const item = previews.get(String(id || ''));
  if (!item || item.usuario !== String(usuario || '')) {
    const e = new Error('Prévia não encontrada ou expirada. Gere o áudio novamente.'); e.status=410; throw e;
  }
  return item.audio;
}
function chave() {
  const value = String(process.env.ELEVENLABS_API_KEY || '').trim();
  if (!value) { const e = new Error('Configure ELEVENLABS_API_KEY no Render.'); e.status = 503; throw e; }
  return value;
}
function escolherVoz(voz) {
  const result = String(voz || process.env.ELEVENLABS_VOICE_ID || '').trim();
  if (!/^[a-zA-Z0-9_-]{10,100}$/.test(result)) {
    const e = new Error('Selecione uma voz disponível ou configure ELEVENLABS_VOICE_ID.'); e.status=400; throw e;
  }
  return result;
}
function validarTexto(texto) {
  const value = String(texto || '').trim();
  if (!value || value.length > MAX_TEXT) {
    const e = new Error(`Digite um texto entre 1 e ${MAX_TEXT} caracteres.`); e.status=400; throw e;
  }
  return value;
}
async function requestEleven(path, options={}) {
  let response;
  try {
    response = await fetch(`${BASE}${path}`, {
      ...options,
      headers: { 'xi-api-key': chave(), ...(options.headers || {}) },
      signal: AbortSignal.timeout(25000)
    });
  } catch (err) {
    const e = new Error('Falha de conexão ou timeout na ElevenLabs.'); e.status=502; throw e;
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const info = body?.detail;
    const detail = typeof info === 'string' ? info : (info?.message || body?.message || 'Verifique sua chave, voz e créditos na ElevenLabs.');
    const e = new Error(`ElevenLabs HTTP ${response.status}: ${String(detail).slice(0,220)}`);
    e.status = response.status === 401 || response.status === 403 ? 502 : (response.status===429 ? 429 : 502);
    throw e;
  }
  return response;
}
async function listarVozes() {
  const response = await requestEleven('/voices');
  const data = await response.json();
  return (Array.isArray(data.voices) ? data.voices : []).map(v => ({
    voice_id: v.voice_id,
    name: v.name || 'Voz',
    category: v.category || '',
    labels: v.labels || {}
  }));
}
async function gerarAudio({ texto, voz }) {
  const msg = validarTexto(texto);
  const vozId = escolherVoz(voz);
  const response = await requestEleven(`/text-to-speech/${encodeURIComponent(vozId)}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept':'audio/mpeg' },
    body: JSON.stringify({ text: msg, model_id: MODEL })
  });
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > MAX_AUDIO) { const e=new Error('O áudio retornado excedeu o limite de teste.'); e.status=413; throw e; }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_AUDIO) {
    const e=new Error('A ElevenLabs retornou um áudio vazio ou grande demais.'); e.status=502; throw e;
  }
  return { bytes, voz: vozId, caracteres: msg.length, formato:'audio/mpeg' };
}
async function enviarAudio(audio, telefone) {
  const phone = validarDestino(telefone);
  const enviado = await zapi.postZapi('/send-audio', {
    phone, audio: `data:audio/mpeg;base64,${audio.bytes.toString('base64')}`
  });
  // Aceito pela Z-API não significa que o WhatsApp entregou a mensagem.
  return { aceitoPelaZapi: true, idMensagem: enviado.zapi?.messageId || enviado.zapi?.id || null,
    telefoneFinal: phone.slice(-4), voz: audio.voz, caracteres: audio.caracteres };
}
async function enviarTeste({texto, voz, telefone}) {
  // Mantém o comportamento anterior: envia mesmo sem gerar uma prévia.
  if (!telefone && !telefonePermitido()) {
    const e = new Error('Informe o WhatsApp de destino ou configure ELEVENLABS_TEST_PHONE.'); e.status=400; throw e;
  }
  const audio = await gerarAudio({texto,voz});
  return enviarAudio(audio, telefone);
}
async function enviarPreview({previewId, telefone}, usuario) {
  const audio = obterPreview(previewId, usuario);
  return enviarAudio(audio, telefone);
}
module.exports = { configurar, listarVozes, gerarAudio, enviarTeste, salvarPreview, enviarPreview };
