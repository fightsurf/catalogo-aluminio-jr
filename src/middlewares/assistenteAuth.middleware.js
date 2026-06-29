const crypto = require('crypto');

function limpar(valor) {
  if (valor === undefined || valor === null) {
    return '';
  }

  return String(valor).trim();
}

function extrairBearerToken(req) {
  const authorization = limpar(req.headers.authorization || req.headers.Authorization);

  if (authorization.toLowerCase().startsWith('bearer ')) {
    return authorization.slice(7).trim();
  }

  return limpar(
    req.headers['x-assistente-api-token'] ||
    req.headers['x-api-token'] ||
    req.query?.token
  );
}

function compararTokens(recebido, esperado) {
  const tokenRecebido = Buffer.from(limpar(recebido));
  const tokenEsperado = Buffer.from(limpar(esperado));

  if (tokenRecebido.length === 0 || tokenRecebido.length !== tokenEsperado.length) {
    return false;
  }

  return crypto.timingSafeEqual(tokenRecebido, tokenEsperado);
}

function assistenteAuth(req, res, next) {
  const tokenEsperado = limpar(process.env.ASSISTENTE_API_TOKEN);

  if (!tokenEsperado) {
    return res.status(503).json({
      success: false,
      ok: false,
      codigo: 'ASSISTENTE_API_TOKEN_NAO_CONFIGURADO',
      mensagem_curta: 'API do assistente não configurada.',
      message: 'ASSISTENTE_API_TOKEN não configurado no ambiente.'
    });
  }

  const tokenRecebido = extrairBearerToken(req);

  if (!compararTokens(tokenRecebido, tokenEsperado)) {
    return res.status(401).json({
      success: false,
      ok: false,
      codigo: 'ASSISTENTE_API_TOKEN_INVALIDO',
      mensagem_curta: 'Acesso não autorizado.',
      message: 'Token do assistente inválido ou ausente.'
    });
  }

  return next();
}

module.exports = assistenteAuth;
