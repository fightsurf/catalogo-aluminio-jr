const crypto = require('crypto');

function limpar(valor) {
  return String(valor || '').trim();
}

function extrairToken(req) {
  const authorization = limpar(req.headers.authorization);
  if (/^Bearer\s+/i.test(authorization)) {
    return authorization.replace(/^Bearer\s+/i, '').trim();
  }

  return limpar(req.headers['x-n8n-api-token']);
}

function tokenIgual(recebido, esperado) {
  const a = Buffer.from(limpar(recebido));
  const b = Buffer.from(limpar(esperado));
  if (!a.length || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function n8nAuth(req, res, next) {
  const esperado = limpar(process.env.N8N_API_TOKEN);

  if (!esperado) {
    return res.status(503).json({
      success: false,
      codigo: 'N8N_API_TOKEN_NAO_CONFIGURADO',
      message: 'N8N_API_TOKEN não configurado no ambiente.'
    });
  }

  if (!tokenIgual(extrairToken(req), esperado)) {
    return res.status(401).json({
      success: false,
      codigo: 'N8N_API_TOKEN_INVALIDO',
      message: 'Token da integração n8n inválido ou ausente.'
    });
  }

  return next();
}

module.exports = n8nAuth;
