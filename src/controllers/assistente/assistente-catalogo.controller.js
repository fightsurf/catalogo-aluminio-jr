const assistenteCatalogoService = require('../../services/assistente/assistente-catalogo.service');

function extrairPayload(req) {
  return {
    mensagem: req.body?.mensagem || req.body?.message || req.body?.texto || req.body?.termo || req.body?.busca || req.query?.mensagem || req.query?.termo || req.query?.busca,
    telefone: req.body?.telefone || req.body?.phone || req.body?.identificador || req.query?.telefone || req.query?.phone,
    contexto: req.body?.contexto || req.body?.context || {},
  };
}

async function resolver(req, res) {
  try {
    const resultado = await assistenteCatalogoService.resolverCatalogo(extrairPayload(req));
    return res.status(200).json(resultado);
  } catch (error) {
    console.error('Erro no resolvedor de catálogo do assistente:', error);
    return res.status(500).json({
      ok: false,
      success: false,
      tratado: false,
      codigo: 'ERRO_RESOLVER_CATALOGO',
      mensagem: 'Erro ao consultar o catálogo.',
      message: error.message,
      produtos: [],
    });
  }
}

module.exports = {
  resolver,
};
