const service = require('../../services/termometro/termometro-vendas.service');

async function carregarTermometro(req, res) {
  try {
    const data = await service.carregarTermometro({
      mes: req.query.mes,
      ano: req.query.ano
    });

    return res.json({ success: true, data });
  } catch (error) {
    console.error('ERRO TERMÔMETRO DE VENDAS:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Erro ao carregar o Termômetro de Vendas.'
    });
  }
}


async function carregarHistoricoProduto(req, res) {
  try {
    const data = await service.carregarHistoricoProduto({
      produtoId: req.params.produtoId,
      mes: req.query.mes,
      ano: req.query.ano,
      meses: req.query.meses
    });

    return res.json({ success: true, data });
  } catch (error) {
    console.error('ERRO HISTÓRICO DO TERMÔMETRO DE VENDAS:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Erro ao carregar o histórico do produto.'
    });
  }
}

module.exports = {
  carregarTermometro,
  carregarHistoricoProduto
};
