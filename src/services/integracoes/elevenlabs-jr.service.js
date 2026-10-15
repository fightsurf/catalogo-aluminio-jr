'use strict';

// Adaptador isolado: ElevenLabs Text-to-Speech -> MP3 -> Z-API.
// Todos os segredos permanecem SOMENTE no servidor Render.
const zapi = require('./zapi.service');
const BASE = 'https://api.elevenlabs.io/v1';
const MODEL = 'eleven_flash_v2_5'; // Suporta português e reduz consumo/latência.
const MAX_TEXT = 1000;
const MAX_AUDIO = 5 * 1024 * 1024;

function configurar() {
  return {
    elevenlabs: Boolean(String(process.env.ELEVENLABS_API_KEY || '').trim()),
    telefoneTeste: Boolean(telefonePermitido()),
    vozPadrao: String(process.env.ELEVENLABS_VOICE_ID || '').trim(),
    modelo: MODEL,
    limiteCaracteres: MAX_TEXT,
    somenteTeste: true
  };
}
function telefonePermitido() {
  const tel = zapi.normalizarTelefone(process.env.ELEVENLABS_TEST_PHONE || '');
  return /^55\d{10,11}$/.test(tel) ? tel : '';
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
async function enviarTeste({texto, voz}) {
  const phone = telefonePermitido();
  if (!phone) { const e = new Error('Configure ELEVENLABS_TEST_PHONE com seu próprio WhatsApp (55 + DDD + número).'); e.status=503; throw e; }
  const audio = await gerarAudio({texto,voz});
  const enviado = await zapi.postZapi('/send-audio', {
    phone, audio: `data:audio/mpeg;base64,${audio.bytes.toString('base64')}`
  });
  // Aceito na fila da Z-API não significa entregue/lido no WhatsApp.
  return { aceitoPelaZapi: true, idMensagem: enviado.zapi?.messageId || enviado.zapi?.id || null,
    telefoneFinal: phone.slice(-4), voz: audio.voz, caracteres: audio.caracteres };
}
module.exports = { configurar, listarVozes, gerarAudio, enviarTeste };
