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
    sem_data_expedicao_semanas: {
      semana_passada: null,
      semana_corrente: null
    }
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

async function listarPedidosSemExpedicaoSemanas(filtros = {}) {
  const response = await legadoBridgeService.get('/api/vendas/performance-expedicao/sem-data-expedicao-semanas', {
    periodo: filtros.periodo
  });

  return response.dados || {
    periodo: filtros.periodo || null,
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
  listarPedidosSemExpedicaoSemanas
};
