const legadoBridgeService = require('../legado/legadoBridge.service');
const clientesCreditosService = require('../legado/clientes-creditos/clientes-creditos.service');

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

async function listarExpedidosPagamentoPendente() {
  const response = await legadoBridgeService.get('/api/vendas/expedidos-pendentes');
  const dados = response.dados || {
    periodo: { data_inicial: null, data_final: null, meses: 6 },
    quantidade_pedidos: 0,
    total_pendente: 0,
    pedidos: []
  };

  const pedidos = Array.isArray(dados.pedidos) ? dados.pedidos : [];
  if (!pedidos.length) {
    return dados;
  }

  // A Baixa para crédito é registrada no PostgreSQL do Render, e não no
  // Firebird legado. Consultamos todas as chaves de pedido em lote para não
  // transformar o auto-refresh da tela em consultas individuais por pedido.
  const chavesBaixadas = await clientesCreditosService.listarChavesPedidosComBaixaParaCredito(pedidos);
  const pedidosFiltrados = pedidos.filter((pedido) => {
    const chave = `${Number(pedido?.empresa ?? -1)}:${Number(pedido?.saida)}:${Number(pedido?.pdv ?? 0)}`;
    return !chavesBaixadas.has(chave);
  });

  return {
    ...dados,
    quantidade_pedidos: pedidosFiltrados.length,
    total_pendente: Number(pedidosFiltrados.reduce((total, pedido) => total + Number(pedido?.valor || 0), 0).toFixed(2)),
    pedidos: pedidosFiltrados
  };
}

module.exports = {
  carregarPerformanceMensal,
  listarPedidosDoDia,
  listarPedidosSemExpedicaoSemanas,
  listarExpedidosPagamentoPendente
};
