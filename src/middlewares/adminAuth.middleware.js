const express = require('express');
const path = require('path');
const crypto = require('crypto');

const COOKIE_NAME = 'ajr_admin_session';
const SESSION_MAX_AGE_MS = Number(process.env.ADMIN_SESSION_MAX_AGE_MS || 8 * 60 * 60 * 1000);

function getAdminUser() {
  return process.env.ADMIN_USER || '';
}

function getAdminPassword() {
  return process.env.ADMIN_PASSWORD || '';
}

function getSessionSecret() {
  return process.env.ADMIN_SESSION_SECRET || '';
}

function isConfigured() {
  return Boolean(getAdminUser() && getAdminPassword() && getSessionSecret());
}

function base64Url(input) {
  return Buffer.from(input).toString('base64url');
}

function sign(payloadBase64, secret) {
  return crypto
    .createHmac('sha256', secret)
    .update(payloadBase64)
    .digest('base64url');
}

function safeEqual(a, b) {
  const aBuffer = Buffer.from(String(a || ''));
  const bBuffer = Buffer.from(String(b || ''));

  if (aBuffer.length !== bBuffer.length) return false;
  return crypto.timingSafeEqual(aBuffer, bBuffer);
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  return header.split(';').reduce((acc, part) => {
    const index = part.indexOf('=');
    if (index === -1) return acc;

    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) acc[key] = decodeURIComponent(value);
    return acc;
  }, {});
}

function createSessionToken(username) {
  const secret = getSessionSecret();
  const now = Date.now();
  const payload = {
    u: username,
    iat: now,
    exp: now + SESSION_MAX_AGE_MS,
  };

  const payloadBase64 = base64Url(JSON.stringify(payload));
  const signature = sign(payloadBase64, secret);
  return `${payloadBase64}.${signature}`;
}

function readSession(req) {
  const secret = getSessionSecret();
  if (!secret) return null;

  const cookies = parseCookies(req);
  const token = cookies[COOKIE_NAME];
  if (!token || !token.includes('.')) return null;

  const [payloadBase64, receivedSignature] = token.split('.');
  const expectedSignature = sign(payloadBase64, secret);
  if (!safeEqual(receivedSignature, expectedSignature)) return null;

  try {
    const payload = JSON.parse(Buffer.from(payloadBase64, 'base64url').toString('utf8'));
    if (!payload || !payload.u || !payload.exp) return null;
    if (Date.now() > payload.exp) return null;
    return payload;
  } catch (err) {
    return null;
  }
}

function isAuthenticated(req) {
  return Boolean(readSession(req));
}

function wantsJson(req) {
  return req.path.startsWith('/api/') || req.xhr || (req.get('accept') || '').includes('application/json');
}

function buildCookieOptions(req) {
  const isHttps = req.secure || req.get('x-forwarded-proto') === 'https';
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: isHttps,
    path: '/',
    maxAge: SESSION_MAX_AGE_MS,
  };
}

function setSessionCookie(req, res, username) {
  res.cookie(COOKIE_NAME, createSessionToken(username), buildCookieOptions(req));
}

function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
  });
}

function requireAuth(req, res, next) {
  const session = readSession(req);
  if (session) {
    req.adminUser = session.u;
    return next();
  }

  if (wantsJson(req)) {
    return res.status(401).json({ erro: 'Sessao administrativa obrigatoria.' });
  }

  const nextUrl = encodeURIComponent(req.originalUrl || '/');
  return res.redirect(`/login?next=${nextUrl}`);
}

const router = express.Router();

router.get('/login', (req, res) => {
  if (isAuthenticated(req)) {
    return res.redirect(req.query.next || '/');
  }

  return res.sendFile(path.join(__dirname, '..', '..', 'views', 'auth', 'login.html'));
});

router.post('/auth/login', (req, res) => {
  if (!isConfigured()) {
    return res.status(500).json({
      erro: 'Login administrativo nao configurado. Configure ADMIN_USER, ADMIN_PASSWORD e ADMIN_SESSION_SECRET no ambiente.',
    });
  }

  const username = String(req.body.usuario || req.body.username || '').trim();
  const password = String(req.body.senha || req.body.password || '');

  const validUser = safeEqual(username, getAdminUser());
  const validPassword = safeEqual(password, getAdminPassword());

  if (!validUser || !validPassword) {
    return res.status(401).json({ erro: 'Usuario ou senha invalidos.' });
  }

  setSessionCookie(req, res, getAdminUser());
  return res.json({ ok: true, redirect: req.body.next || '/' });
});

router.get('/auth/status', (req, res) => {
  const session = readSession(req);
  return res.json({
    autenticado: Boolean(session),
    usuario: session ? session.u : null,
  });
});

router.post('/auth/logout', (req, res) => {
  clearSessionCookie(res);
  return res.json({ ok: true });
});

router.get('/auth/logout', (req, res) => {
  clearSessionCookie(res);
  return res.redirect('/login');
});

module.exports = {
  authRoutes: router,
  requireAuth,
  isAuthenticated,
};
