const legadoBridgeService = require('../legadoBridge.service');

function limparTexto(valor) {
  if (valor === undefined || valor === null) {
    return '';
  }

  return String(valor).trim();
}

function numero(valor) {
  const convertido = Number(valor ?? 0);
  return Number.isFinite(convertido) ? Number(convertido) : 0;
}

function normalizarPedido(item = {}) {
  return {
    empresa: item.empresa ?? -1,
    saida: item.saida ?? null,
    pdv: item.pdv ?? 0,
    numero: limparTexto(item.numero),
    data: item.data ?? null,
    cliente: {
      favorecido: item?.cliente?.favorecido ?? null,
      nome: limparTexto(item?.cliente?.nome),
      cidade: limparTexto(item?.cliente?.cidade),
      uf: limparTexto(item?.cliente?.uf)
    },
    vendedor: {
      favorecido: item?.vendedor?.favorecido ?? null,
      nome: limparTexto(item?.vendedor?.nome)
    },
    valor: numero(item.valor),
    totalPago: numero(item.totalPago),
    quitado: Boolean(item.quitado),
    carrada: item?.carrada?.codigo
      ? {
          codigo: item.carrada.codigo,
          data: item.carrada.data ?? null,
          descricao: limparTexto(item.carrada.descricao)
        }
      : null
  };
}

function normalizarCarrada(item = {}) {
  return {
    codigo: item.codigo ?? null,
    data: item.data ?? null,
    descricao: limparTexto(item.descricao),
    qtdePedidos: numero(item.qtdePedidos),
    valorTotalPedidos: numero(item.valorTotalPedidos),
    valorPagoPedidos: numero(item.valorPagoPedidos)
  };
}

async function obterDashboardPedidos() {
  const response = await legadoBridgeService.get('/api/dashboard-pedidos');
  const dado = response?.dado || {};

  return {
    filtros: {
      diasPedidos: Number(dado?.filtros?.diasPedidos || 30),
      diasCarradas: Number(dado?.filtros?.diasCarradas || 60)
    },
    pedidos: Array.isArray(dado.pedidos) ? dado.pedidos.map(normalizarPedido) : [],
    carradas: Array.isArray(dado.carradas) ? dado.carradas.map(normalizarCarrada) : []
  };
}

module.exports = {
  obterDashboardPedidos
};
