const assistenteProdutosService = require('../../services/assistente/assistente-produtos.service');

function extrairPayload(req) {
  return {
    termo: req.body?.termo || req.body?.busca || req.body?.produto || req.query?.termo || req.query?.busca || req.query?.produto,
    quantidade: req.body?.quantidade || req.body?.qtd || req.query?.quantidade || req.query?.qtd
  };
}

async function consultar(req, res) {
  try {
    const resultado = await assistenteProdutosService.consultarProduto(extrairPayload(req));

    return res.status(200).json(resultado);
  } catch (error) {
    console.error('Erro na consulta de produtos do assistente:', error);

    return res.status(500).json({
      success: false,
      ok: false,
      mensagem_curta: 'Erro ao consultar produto.',
      message: error.message
    });
  }
}

module.exports = {
  consultar
};
