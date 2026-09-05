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

module.exports = {
  carregarTermometro
};
