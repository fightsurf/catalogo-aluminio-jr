const legadoBridgeService = require('../legado/legadoBridge.service');

async function carregarPerformanceMensal(filtros = {}) {
  const response = await legadoBridgeService.get('/api/vendas/performance-expedicao', {
    mes: filtros.mes,
    ano: filtros.ano
  });

  return response.dados || {
    regra: 'Pedidos agrupados pela data de expedição (SAIDAS.CAMPO01). Pedidos cancelados são ignorados.',
    atual: null,
    anterior: null,
    sem_data_expedicao_120_dias: null
  };
}

async function listarPedidosDoDia(filtros = {}) {
  const response = await legadoBridgeService.get('/api/vendas/performance-expedicao/pedidos-dia', {
    data: filtros.data
  });

  return response.dados || {
    data: filtros.data || null,
    total: 0,
    quantidade_pedidos: 0,
    pedidos: []
  };
}

async function listarPedidosSemExpedicao120Dias() {
  const response = await legadoBridgeService.get('/api/vendas/performance-expedicao/sem-data-expedicao-120-dias');

  return response.dados || {
    janela_dias: 120,
    data_inicial: null,
    data_final: null,
    total: 0,
    quantidade_pedidos: 0,
    pedidos: []
  };
}

module.exports = {
  carregarPerformanceMensal,
  listarPedidosDoDia,
  listarPedidosSemExpedicao120Dias
};
