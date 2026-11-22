'use strict';

const express = require('express');
const { requireAuth } = require('../../middlewares/adminAuth.middleware');
const auth = require('../../services/integracao/mcpClientesOAuth.service');

const router = express.Router();

router.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  if (!auth.enabled()) return res.status(503).json({ erro: 'Consulta MCP de clientes desativada.' });
  next();
});

function protectedMetadata(_req, res) {
  return res.json({
    resource: auth.resource(),
    authorization_servers: [auth.issuer()],
    scopes_supported: ['clientes:read', 'offline_access']
  });
}
router.get('/.well-known/oauth-protected-resource', protectedMetadata);
router.get('/.well-known/oauth-protected-resource/mcp/clientes', protectedMetadata);
router.get('/.well-known/oauth-authorization-server', (_req, res) => {
  const host = auth.issuer();
  return res.json({
    issuer: host,
    authorization_response_iss_parameter_supported: true,
    authorization_endpoint: host + '/oauth/mcp-clientes/authorize',
    token_endpoint: host + '/oauth/mcp-clientes/token',
    client_id_metadata_document_supported: true,
    token_endpoint_auth_methods_supported: ['none'],
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    scopes_supported: ['clientes:read', 'offline_access']
  });
});
router.get('/oauth/mcp-clientes/authorize', requireAuth, async (req, res) => {
  try {
    const pedido = await auth.newAuthRequest(req.query, req.adminUser);
    res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'");
    res.set('X-Frame-Options', 'DENY');
    res.type('html');
    return res.send([
      '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
      '<title>Autorizar consulta de clientes — Alumínio JR</title>',
      '<style>body{font:16px system-ui,sans-serif;max-width:520px;margin:10vh auto;padding:24px;color:#15202a}',
      'form{display:flex;gap:12px}button{padding:12px 18px;cursor:pointer}h1{font-size:24px}</style>',
      '</head><body><h1>Autorizar consulta de clientes</h1>',
      '<p>Conta administrativa: <strong>', auth.escapeHtml(req.adminUser), '</strong>.</p>',
      '<p>Permitir que o ChatGPT consulte <strong>nome, código, cidade e UF</strong> ',
      'dos clientes, além de <strong>transportadoras, cidades e localidades atendidas</strong> ',
      'pela Alumínio JR. Não inclui telefones, documentos, observações ou pedidos. ',
      'Nenhuma gravação será habilitada.</p>',
      '<p>Você poderá revogar a autorização removendo o plugin e desativando o MCP no servidor.</p>',
      '<form method="post" action="/oauth/mcp-clientes/authorize">',
      '<input type="hidden" name="id" value="', auth.escapeHtml(pedido.id), '">',
      '<input type="hidden" name="csrf" value="', auth.escapeHtml(pedido.csrf), '">',
      '<button name="decision" value="aprovar" type="submit">Autorizar consulta</button>',
      '<button name="decision" value="negar" type="submit">Cancelar</button>',
      '</form></body></html>'
    ].join(''));
  } catch (err) {
    console.error('[mcp/clientes/oauth] Autorização inválida:', err.oauthCode || err.message);
    return res.status(400).send('Não foi possível iniciar a autorização. Verifique a configuração OAuth.');
  }
});
router.post('/oauth/mcp-clientes/authorize', requireAuth, async (req, res) => {
  try {
    const url = await auth.decideConsent({
      id: req.body.id, csrf: req.body.csrf,
      decision: req.body.decision, user: req.adminUser
    });
    return res.redirect(302, url);
  } catch (err) {
    return res.status(400).send('Solicitação de autorização inválida ou expirada.');
  }
});
router.post('/oauth/mcp-clientes/token', async (req, res) => {
  res.set('Pragma', 'no-cache');
  try {
    const response = await auth.exchangeToken(req.body || {});
    return res.json(response);
  } catch (err) {
    const code = err.oauthCode || 'server_error';
    if (!err.oauthCode) console.error('[mcp/clientes/oauth] Token:', err.message);
    return res.status(code === 'server_error' ? 500 : 400).json({ error: code });
  }
});

module.exports = router;
