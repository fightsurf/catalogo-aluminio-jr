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

async function listarPedidosDoDia(req, res) {
  try {
    const data = await service.listarPedidosDoDia({
      data: req.query.data
    });

    return res.json({ success: true, data });
  } catch (error) {
    console.error('ERRO PEDIDOS DO DIA - PERFORMANCE VENDAS:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Erro ao carregar pedidos do dia.'
    });
  }
}

module.exports = {
  carregarPerformanceMensal,
  listarPedidosDoDia
};
