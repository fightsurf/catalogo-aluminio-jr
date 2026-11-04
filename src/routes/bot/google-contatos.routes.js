'use strict';
const express = require('express');
const crypto = require('crypto');
const google = require('../../services/bot/google-contatos.service');
const router = express.Router();
const COOKIE = 'ajr_google_contatos_oauth';

function seguro(req) {
  return req.secure || req.get('x-forwarded-proto') === 'https';
}
function options(req) {
  return { httpOnly: true, secure: seguro(req), sameSite: 'lax',
    path: '/bot/admin/google-contatos', maxAge: 10 * 60 * 1000 };
}
function cookie(req, nome) {
  const partes = String(req.headers.cookie || '').split(';');
  const par = partes.find(p => p.trim().startsWith(nome + '='));
  return par ? decodeURIComponent(par.trim().slice(nome.length + 1)) : '';
}
function igual(a, b) {
  const um = Buffer.from(String(a || ''), 'utf8');
  const dois = Buffer.from(String(b || ''), 'utf8');
  return um.length === dois.length && crypto.timingSafeEqual(um, dois);
}
function erro(res, e) {
  res.set('Cache-Control', 'no-store');
  return res.status(e.status || 500).json({
    success: false, message: e.status ? e.message : 'Falha na integracao Google Contatos.'
  });
}

router.get('/status', async (_req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json(await google.status());
  } catch (e) { erro(res, e); }
});

router.get('/conectar', async (req, res) => {
  try {
    await google.exigirBot();
    const state = crypto.randomBytes(32).toString('hex');
    const destino = google.urlAutorizacao(state);
    res.cookie(COOKIE, state, options(req));
    res.set('Cache-Control', 'no-store');
    res.redirect(destino);
  } catch (e) { erro(res, e); }
});

router.get('/callback', async (req, res) => {
  const guardado = cookie(req, COOKIE);
  res.clearCookie(COOKIE, options(req));
  if (!guardado || !igual(guardado, req.query.state) || !req.query.code) {
    return res.status(400).send('Autorizacao Google invalida ou expirada. Retorne ao painel e tente novamente.');
  }
  try {
    await google.exigirBot();
    await google.conectarCodigo(String(req.query.code));
    try { await google.sincronizar(); }
    catch (e) { console.warn('[Google Contatos JR] Primeira sincronizacao:', e.message); }
    return res.redirect('/bot/admin?google_contatos=conectado');
  } catch (e) {
    console.error('[Google Contatos JR] Autorizacao:', e.message);
    return res.redirect('/bot/admin?google_contatos=erro');
  }
});

router.post('/sincronizar', async (_req, res) => {
  try { res.set('Cache-Control', 'no-store'); res.json(await google.sincronizar()); }
  catch (e) { erro(res, e); }
});

router.post('/desconectar', async (_req, res) => {
  try {
    await google.desconectar();
    res.set('Cache-Control', 'no-store');
    res.json({ success: true });
  } catch (e) { erro(res, e); }
});
module.exports = router;
