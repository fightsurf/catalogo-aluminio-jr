'use strict';

// Piloto de upload TikTok: envio para caixa de entrada, NAO publica automaticamente.
// Requer Login Kit + permissao oficial video.upload e conclusao no aplicativo TikTok.
const express = require('express');
const multer = require('multer');
const crypto = require('node:crypto');
const path = require('node:path');
const { requireAuth } = require('../../middlewares/adminAuth.middleware');

const router = express.Router();
router.use(requireAuth);
const TOKEN_COOKIE = 'ajr_tiktok_pilot';
const STATE_COOKIE = 'ajr_tiktok_state';
const MAX_BYTES = 30 * 1024 * 1024;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1, fields: 0 },
  fileFilter: (_req, file, cb) => {
    if (path.extname(file.originalname).toLowerCase() !== '.mp4' ||
        file.mimetype !== 'video/mp4') return cb(new Error('Somente video MP4 e permitido neste teste.'));
    cb(null, true);
  }
});

function enabled() {
  return Boolean(process.env.TIKTOK_CLIENT_KEY &&
    process.env.TIKTOK_CLIENT_SECRET &&
    process.env.TIKTOK_REDIRECT_URI &&
    process.env.ADMIN_SESSION_SECRET);
}
function cookieOptions(req, maxAge) {
  return { httpOnly: true, sameSite: 'lax', secure: Boolean(req.secure ||
    req.get('x-forwarded-proto') === 'https'), path: '/', maxAge };
}
function readCookie(req, key) {
  const cookie = String(req.get('cookie') || '');
  const item = cookie.split(';').map(v => v.trim()).find(v => v.startsWith(key + '='));
  return item ? item.slice(key.length + 1) : '';
}
function secretKey() {
  return crypto.createHash('sha256').update(process.env.ADMIN_SESSION_SECRET).digest();
}
function encrypt(obj) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', secretKey(), iv);
  const raw = Buffer.concat([cipher.update(JSON.stringify(obj), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), raw]).toString('base64url');
}
function decrypt(data) {
  try {
    const raw = Buffer.from(data, 'base64url');
    if (raw.length < 29) return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', secretKey(), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8'));
  } catch (_) { return null; }
}
function tokens(req) {
  if (!enabled()) return null;
  const token = decrypt(readCookie(req, TOKEN_COOKIE));
  return token && token.access_token && token.expires_at > Date.now() + 30000 ? token : null;
}
function sameOrigin(req, res, next) {
  const origin = req.get('origin');
  if (origin && origin !== String(req.protocol) + '://' + req.get('host')) {
    return res.status(403).json({ success: false, message: 'Origem da requisicao nao autorizada.' });
  }
  next();
}
function wrap(fn) {
  return async (req, res) => {
    try { await fn(req, res); }
    catch (error) {
      // Nao registrar tokens, URL de upload ou conteudo de videos nos logs.
      console.error('[TikTok piloto]', String(error.code || error.name || 'erro'));
      res.status(error.status || 400).json({
        success: false,
        message: String(error.message || 'Falha no teste TikTok').slice(0, 250)
      });
    }
  };
}
async function api(endpoint, token, data) {
  const response = await fetch('https://open.tiktokapis.com' + endpoint, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(25000),
    headers: { 'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify(data)
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || (json.error && json.error.code && json.error.code !== 'ok')) {
    const code = String(json.error && json.error.code || response.status);
    const err = new Error('TikTok recusou a operacao: ' + code);
    err.status = response.status === 401 ? 401 : 400;
    throw err;
  }
  return json.data || {};
}

router.get('/', (_req, res) =>
  res.sendFile(path.resolve(__dirname, '../../../views/marketing/tiktok-piloto.html')));

router.get('/api/config', (req, res) =>
  res.json({ success: true, configured: enabled(), connected: Boolean(tokens(req)),
    mode: 'enviar_para_caixa_de_entrada', maxBytes: MAX_BYTES }));

router.get('/oauth/start', (req, res) => {
  if (!enabled()) return res.status(503).send('Configure TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET e TIKTOK_REDIRECT_URI no Render.');
  const state = crypto.randomBytes(24).toString('hex');
  res.cookie(STATE_COOKIE, state, cookieOptions(req, 10 * 60 * 1000));
  const url = new URL('https://www.tiktok.com/v2/auth/authorize/');
  url.searchParams.set('client_key', process.env.TIKTOK_CLIENT_KEY);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'user.info.basic,video.upload');
  url.searchParams.set('redirect_uri', process.env.TIKTOK_REDIRECT_URI);
  url.searchParams.set('state', state);
  res.redirect(url.toString());
});

router.get('/oauth/callback', wrap(async (req, res) => {
  const received = String(req.query.state || '');
  const expected = readCookie(req, STATE_COOKIE);
  res.clearCookie(STATE_COOKIE, cookieOptions(req, 0));
  if (!enabled() || !received || !expected ||
    received.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(received), Buffer.from(expected))) {
    return res.status(403).send('Conexao TikTok recusada: state invalido.');
  }
  if (req.query.error) return res.status(403).send('A autorizacao TikTok foi negada.');
  const code = String(req.query.code || '');
  if (!code || code.length > 2048) return res.status(400).send('Codigo de autorizacao ausente.');
  const body = new URLSearchParams({
    client_key: process.env.TIKTOK_CLIENT_KEY,
    client_secret: process.env.TIKTOK_CLIENT_SECRET,
    code, grant_type: 'authorization_code',
    redirect_uri: process.env.TIKTOK_REDIRECT_URI
  });
  const response = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(25000),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || !json.access_token || !String(json.scope || '').split(',').includes('video.upload')) {
    return res.status(403).send('O TikTok nao concedeu a permissao video.upload para este aplicativo.');
  }
  res.cookie(TOKEN_COOKIE, encrypt({
    access_token: json.access_token, open_id: json.open_id,
    expires_at: Date.now() + Math.min(Number(json.expires_in || 7200), 7200) * 1000
  }), cookieOptions(req, 2 * 60 * 60 * 1000));
  res.redirect('/marketing/tiktok?conectado=1');
}));

router.post('/api/desconectar', sameOrigin, (req, res) => {
  res.clearCookie(TOKEN_COOKIE, cookieOptions(req, 0));
  res.json({ success: true, message: 'Sessao local TikTok encerrada. Revogue o acesso no TikTok se necessario.' });
});

// Verifica somente o recebimento local. O buffer e descartado depois da resposta.
router.post('/api/verificar-upload', sameOrigin, upload.single('video'), wrap(async (req, res) => {
  const file = req.file;
  if (!file || file.size < 8 || file.buffer.toString('ascii', 4, 8) !== 'ftyp') {
    return res.status(400).json({ success: false, message: 'Arquivo MP4 invalido.' });
  }
  res.json({ success: true, received: true, published: false,
    name: file.originalname, bytes: file.size,
    sha256: crypto.createHash('sha256').update(file.buffer).digest('hex') });
}));

// Requer conta autorizada. O envio cria notificacao de rascunho, nao publicacao publica.
router.post('/api/enviar', sameOrigin, upload.single('video'), wrap(async (req, res) => {
  const user = tokens(req);
  if (!user) return res.status(401).json({
    success: false, message: 'Conecte sua conta TikTok antes de enviar o video.' });
  const file = req.file;
  if (!file || file.size < 8 || file.buffer.toString('ascii', 4, 8) !== 'ftyp') {
    return res.status(400).json({ success: false, message: 'Arquivo MP4 invalido.' });
  }
  const info = await api('/v2/post/publish/inbox/video/init/', user.access_token, {
    source_info: { source: 'FILE_UPLOAD', video_size: file.size,
      chunk_size: file.size, total_chunk_count: 1 }
  });
  if (!info.upload_url || !info.publish_id) throw new Error('TikTok nao devolveu o endereco de envio.');
  const target = new URL(info.upload_url);
  if (target.protocol !== 'https:' || !/(^|\.)tiktokapis\.com$/i.test(target.hostname))
    throw new Error('URL de envio inesperada.');
  const response = await fetch(target.toString(), {
    method: 'PUT', redirect: 'error', signal: AbortSignal.timeout(120000),
    headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(file.size),
      'Content-Range': 'bytes 0-' + (file.size - 1) + '/' + file.size },
    body: file.buffer
  });
  if (response.status !== 201) {
    // Nao repetir automaticamente: o TikTok pode ter recebido o video.
    throw new Error('Resultado do envio incerto (HTTP ' + response.status + '). Confira a caixa de entrada do TikTok antes de tentar novamente.');
  }
  res.status(202).json({ success: true, sent: true, published: false,
    publish_id: info.publish_id,
    message: 'Video enviado ao TikTok. Abra a notificacao no aplicativo para editar e publicar.' });
}));

router.post('/api/status', sameOrigin, express.json(), wrap(async (req, res) => {
  const user = tokens(req);
  if (!user) return res.status(401).json({ success: false, message: 'Conecte sua conta.' });
  const id = String(req.body && req.body.publish_id || '');
  if (!/^[A-Za-z0-9._~-]{1,64}$/.test(id)) {
    return res.status(400).json({ success: false, message: 'Identificador de postagem invalido.' });
  }
  const data = await api('/v2/post/publish/status/fetch/', user.access_token, { publish_id: id });
  res.json({ success: true, status: data.status || 'DESCONHECIDO',
    fail_reason: data.fail_reason || null,
    publicaly_available_post_id: data.publicaly_available_post_id || [] });
}));

router.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ success: false, message: 'O limite do piloto e 30 MB por video.' });
  }
  res.status(400).json({ success: false, message: 'Upload rejeitado: ' + String(err.message || 'arquivo invalido').slice(0,120) });
});

module.exports = router;
