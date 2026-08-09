const service = require('../../services/vendas/performance-expedicao.service');

async function carregarPerformanceMensal(req, res) {
  try {
    const data = await service.carregarPerformanceMensal({
      mes: req.query.mes,
      ano: req.query.ano
    });

    return res.json({ success: true, data });
  } catch (error) {
    console.error('ERRO PERFORMANCE EXPEDIÇÃO:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Erro ao carregar performance de expedição.'
    });
  }
}

async function listarPedidosDoDia(req, res) {
  try {
    const data = await service.listarPedidosDoDia({ data: req.query.data });
    return res.json({ success: true, data });
  } catch (error) {
    console.error('ERRO PEDIDOS EXPEDIDOS DO DIA:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Erro ao carregar pedidos expedidos do dia.'
    });
  }
}

async function listarPedidosSemExpedicao120Dias(req, res) {
  try {
    const data = await service.listarPedidosSemExpedicao120Dias();
    return res.json({ success: true, data });
  } catch (error) {
    console.error('ERRO PEDIDOS SEM DATA DE EXPEDIÇÃO:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Erro ao carregar pedidos sem data de expedição.'
    });
  }
}

module.exports = {
  carregarPerformanceMensal,
  listarPedidosDoDia,
  listarPedidosSemExpedicao120Dias
};
