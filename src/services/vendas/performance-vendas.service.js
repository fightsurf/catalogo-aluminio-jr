const legadoBridgeService = require('../legado/legadoBridge.service');

async function carregarPerformanceMensal(filtros = {}) {
  const response = await legadoBridgeService.get('/api/vendas/performance-vendas', {
    mes: filtros.mes,
    ano: filtros.ano
  });

  return response.dados || {
    regra: 'Vendas agrupadas pela data do pedido (SAIDAS.DATA). Pedidos cancelados (SITUACAO = C) são ignorados.',
    atual: null,
    anterior: null
  };
}

async function listarPedidosDoDia(filtros = {}) {
  const response = await legadoBridgeService.get('/api/vendas/performance-vendas/pedidos-dia', {
    data: filtros.data
  });

  return response.dados || {
    data: filtros.data || null,
    total: 0,
    quantidade_pedidos: 0,
    pedidos: []
  };
}

module.exports = {
  carregarPerformanceMensal,
  listarPedidosDoDia
};
