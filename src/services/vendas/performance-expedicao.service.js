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
    sem_data_expedicao_semanas: null
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

async function listarPedidosSemExpedicaoSemanas() {
  const response = await legadoBridgeService.get('/api/vendas/performance-expedicao/sem-data-expedicao-semanas');

  return response.dados || {
    periodo: 'semana_passada_e_corrente',
    data_inicial: null,
    data_final: null,
    semana_passada_inicio: null,
    semana_passada_fim: null,
    semana_corrente_inicio: null,
    semana_corrente_fim: null,
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
