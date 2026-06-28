const service = require('../../services/vendas/performance-vendas.service');

async function carregarPerformanceMensal(req, res) {
  try {
    const data = await service.carregarPerformanceMensal({
      mes: req.query.mes,
      ano: req.query.ano
    });

    return res.json({ success: true, data });
  } catch (error) {
    console.error('ERRO PERFORMANCE VENDAS:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Erro ao carregar performance de vendas.'
    });
  }
}

module.exports = {
  carregarPerformanceMensal
};
