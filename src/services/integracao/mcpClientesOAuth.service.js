'use strict';

const crypto = require('crypto');
const pool = require('../../../db/connection');

// OAuth 2.1, authorization code + PKCE S256, CIMD estável do ChatGPT.
// Tokens opacos são armazenados apenas como SHA-256 no PostgreSQL.
const CLIENT_ID = 'https://chatgpt.com/oauth/client.json';
const REDIRECT = 'https://chatgpt.com/connector_platform_oauth_redirect';
const ALLOWED_SCOPES = new Set(['clientes:read', 'pedidos:write', 'offline_access']);
let schemaPromise;
let cimdCacheUntil = 0;

function enabled() {
  return process.env.MCP_CLIENTES_ENABLED === 'true' &&
    Boolean(process.env.ADMIN_USER && process.env.ADMIN_PASSWORD && process.env.ADMIN_SESSION_SECRET);
}
function origin() {
  const value = (process.env.MCP_CLIENTES_PUBLIC_ORIGIN || 'https://catalogo-aluminio-jr.onrender.com').replace(/\/$/, '');
  const u = new URL(value);
  if (u.protocol !== 'https:' || u.pathname !== '/' || u.search || u.hash || u.username || u.password) {
    throw new Error('MCP_CLIENTES_PUBLIC_ORIGIN deve ser origem HTTPS sem caminho.');
  }
  return value;
}
function resource() { return origin() + '/mcp/clientes'; }
function metadataUrl() { return origin() + '/.well-known/oauth-protected-resource/mcp/clientes'; }
function issuer() { return origin(); }
function h(value) { return crypto.createHash('sha256').update(String(value)).digest('hex'); }
function token() { return crypto.randomBytes(32).toString('base64url'); }
function same(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function oauthError(code, message) {
  const e = new Error(message || code);
  e.oauthCode = code;
  return e;
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
async function schema() {
  if (!schemaPromise) schemaPromise = pool.query([
    'CREATE TABLE IF NOT EXISTS mcp_clientes_oauth_pedidos (',
    'id UUID PRIMARY KEY, csrf_hash CHAR(64) NOT NULL, usuario TEXT NOT NULL,',
    'estado TEXT NOT NULL, escopo TEXT NOT NULL, desafio TEXT NOT NULL,',
    'criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),',
    'expira_em TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL \x2710 minutes\x27),',
    'consumido_em TIMESTAMPTZ);',
    'CREATE TABLE IF NOT EXISTS mcp_clientes_oauth_codigos (',
    'codigo_hash CHAR(64) PRIMARY KEY, usuario TEXT NOT NULL, escopo TEXT NOT NULL,',
    'desafio TEXT NOT NULL, expira_em TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL \x275 minutes\x27),',
    'consumido_em TIMESTAMPTZ);',
    'CREATE TABLE IF NOT EXISTS mcp_clientes_oauth_acessos (',
    'token_hash CHAR(64) PRIMARY KEY, usuario TEXT NOT NULL, escopo TEXT NOT NULL,',
    'recurso TEXT NOT NULL, expira_em TIMESTAMPTZ NOT NULL, criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW());',
    'CREATE TABLE IF NOT EXISTS mcp_clientes_oauth_refresh (',
    'token_hash CHAR(64) PRIMARY KEY, usuario TEXT NOT NULL, escopo TEXT NOT NULL,',
    'recurso TEXT NOT NULL, cliente TEXT NOT NULL, expira_em TIMESTAMPTZ NOT NULL,',
    'consumido_em TIMESTAMPTZ, criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW());',
    'CREATE INDEX IF NOT EXISTS idx_mcp_clientes_oauth_expiracao ON mcp_clientes_oauth_acessos (expira_em);'
  ].join(' ')).catch(e => { schemaPromise = null; throw e; });
  return schemaPromise;
}
async function validateCimd() {
  if (Date.now() < cimdCacheUntil) return;
  const response = await fetch(CLIENT_ID, { signal: AbortSignal.timeout(6000), redirect: 'error' });
  if (!response.ok) throw oauthError('temporarily_unavailable', 'Não foi possível validar o cliente OAuth.');
  const doc = await response.json();
  if (doc.client_id !== CLIENT_ID || !Array.isArray(doc.redirect_uris) ||
      !doc.redirect_uris.includes(REDIRECT) ||
      !Array.isArray(doc.token_endpoint_auth_methods_supported) ||
      !doc.token_endpoint_auth_methods_supported.includes('none')) {
    throw oauthError('invalid_client', 'Metadados CIMD incompatíveis.');
  }
  cimdCacheUntil = Date.now() + 300000;
}
function validateAuthorize(q) {
  if (q.response_type !== 'code') throw oauthError('unsupported_response_type');
  if (q.client_id !== CLIENT_ID || q.redirect_uri !== REDIRECT) throw oauthError('invalid_client');
  if (q.resource !== resource()) throw oauthError('invalid_target');
  if (q.code_challenge_method !== 'S256' ||
      !/^[A-Za-z0-9_-]{43}$/.test(String(q.code_challenge || ''))) throw oauthError('invalid_request', 'PKCE S256 obrigatório.');
  if (typeof q.state !== 'string' || q.state.length < 8 || q.state.length > 512) throw oauthError('invalid_request', 'Estado OAuth inválido.');
  const scopes = String(q.scope || '').split(/\s+/).filter(Boolean);
  if (!scopes.includes('clientes:read') || scopes.some(s => !ALLOWED_SCOPES.has(s))) throw oauthError('invalid_scope');
  return { state: q.state, scope: [...new Set(scopes)].join(' '), challenge: q.code_challenge };
}
async function newAuthRequest(q, user) {
  if (!enabled()) throw oauthError('temporarily_unavailable', 'Integração desativada.');
  const data = validateAuthorize(q);
  await validateCimd();
  await schema();
  const id = crypto.randomUUID(), csrf = token();
  await pool.query(
    'INSERT INTO mcp_clientes_oauth_pedidos (id, csrf_hash, usuario, estado, escopo, desafio) VALUES ($1,$2,$3,$4,$5,$6)',
    [id, h(csrf), user, data.state, data.scope, data.challenge]
  );
  return { id, csrf, scope: data.scope };
}
function redirectResponse({ code, state, error }) {
  const u = new URL(REDIRECT);
  if (code) u.searchParams.set('code', code);
  if (error) u.searchParams.set('error', error);
  u.searchParams.set('state', state);
  u.searchParams.set('iss', issuer());
  return u.toString();
}
async function decideConsent({ id, csrf, decision, user }) {
  if (!enabled()) throw oauthError('temporarily_unavailable');
  if (!/^[a-f0-9-]{36}$/i.test(String(id || '')) || !/^[A-Za-z0-9_-]{43}$/.test(String(csrf || ''))) {
    throw oauthError('invalid_request');
  }
  await schema();
  const result = await pool.query(
    'UPDATE mcp_clientes_oauth_pedidos SET consumido_em=NOW() ' +
    'WHERE id=$1 AND csrf_hash=$2 AND usuario=$3 AND consumido_em IS NULL AND expira_em>NOW() ' +
    'RETURNING estado, escopo, desafio, usuario',
    [id, h(csrf), user]
  );
  if (!result.rows.length) throw oauthError('invalid_request', 'Autorização expirada ou já utilizada.');
  const row = result.rows[0];
  if (decision !== 'aprovar') return redirectResponse({ state: row.estado, error: 'access_denied' });
  const code = token();
  await pool.query(
    'INSERT INTO mcp_clientes_oauth_codigos (codigo_hash, usuario, escopo, desafio) VALUES ($1,$2,$3,$4)',
    [h(code), row.usuario, row.escopo, row.desafio]
  );
  return redirectResponse({ code, state: row.estado });
}
async function issueTokens(user, scope) {
  const access = token();
  const expires = 900;
  await pool.query(
    'INSERT INTO mcp_clientes_oauth_acessos(token_hash,usuario,escopo,recurso,expira_em) ' +
    "VALUES($1,$2,$3,$4,NOW()+INTERVAL '15 minutes')",
    [h(access), user, scope, resource()]
  );
  const response = { access_token: access, token_type: 'Bearer', expires_in: expires, scope };
  // OAuth clients públicos do ChatGPT podem solicitar apenas clientes:read.
  // O RFC 6749 permite emitir refresh_token na troca de authorization_code;
  // assim a conexão não depende do escopo opcional offline_access.
  {
    const refresh = token();
    await pool.query(
      'INSERT INTO mcp_clientes_oauth_refresh(token_hash,usuario,escopo,recurso,cliente,expira_em) ' +
      "VALUES($1,$2,$3,$4,$5,NOW()+INTERVAL '30 days')",
      [h(refresh), user, scope, resource(), CLIENT_ID]
    );
    response.refresh_token = refresh;
  }
  return response;
}
async function exchangeToken(body) {
  if (!enabled()) throw oauthError('temporarily_unavailable');
  if (body.client_id !== CLIENT_ID) throw oauthError('invalid_client');
  if (body.resource !== undefined && body.resource !== resource()) throw oauthError('invalid_target');
  await schema();
  if (body.grant_type === 'authorization_code') {
    if (body.redirect_uri !== REDIRECT) throw oauthError('invalid_grant');
    const verifier = String(body.code_verifier || '');
    if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) throw oauthError('invalid_grant');
    const code = String(body.code || '');
    if (code.length < 30 || code.length > 200) throw oauthError('invalid_grant');
    const result = await pool.query(
      'UPDATE mcp_clientes_oauth_codigos SET consumido_em=NOW() ' +
      'WHERE codigo_hash=$1 AND consumido_em IS NULL AND expira_em>NOW() ' +
      'RETURNING usuario,escopo,desafio',
      [h(code)]
    );
    if (!result.rows.length) throw oauthError('invalid_grant');
    const row = result.rows[0];
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    if (!same(challenge, row.desafio)) throw oauthError('invalid_grant');
    return issueTokens(row.usuario, row.escopo);
  }
  if (body.grant_type === 'refresh_token') {
    const refresh = String(body.refresh_token || '');
    if (refresh.length < 30 || refresh.length > 200) throw oauthError('invalid_grant');
    const result = await pool.query(
      'UPDATE mcp_clientes_oauth_refresh SET consumido_em=NOW() ' +
      'WHERE token_hash=$1 AND cliente=$2 AND recurso=$3 AND consumido_em IS NULL AND expira_em>NOW() ' +
      'RETURNING usuario,escopo',
      [h(refresh), CLIENT_ID, resource()]
    );
    if (!result.rows.length) throw oauthError('invalid_grant');
    return issueTokens(result.rows[0].usuario, result.rows[0].escopo);
  }
  throw oauthError('unsupported_grant_type');
}
async function validateAccess(access) {
  if (!enabled() || typeof access !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(access)) return null;
  await schema();
  const r = await pool.query(
    'SELECT usuario,escopo,recurso FROM mcp_clientes_oauth_acessos WHERE token_hash=$1 AND expira_em>NOW()',
    [h(access)]
  );
  const row = r.rows[0];
  if (!row || row.recurso !== resource() || !row.escopo.split(' ').includes('clientes:read')) return null;
  return { user: row.usuario, scope: row.escopo };
}
module.exports = {
  CLIENT_ID, REDIRECT, enabled, resource, issuer, metadataUrl, escapeHtml,
  newAuthRequest, decideConsent, exchangeToken, validateAccess, oauthError
};
