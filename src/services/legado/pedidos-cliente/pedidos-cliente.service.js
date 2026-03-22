function normalizarPedido(item) {
  return {
    saida: item.saida ?? item.SAIDA ?? null,
    numero: item.numero ?? item.NUMERO ?? null,
    data: item.data ?? item.DATA ?? null,
    total: Number(item.total ?? item.TOTAL ?? 0),
    VendedorNome:
      item.VendedorNome ??
      item.VENDEDORNOME ??
      item.vendedornome ??
      ''
  };
}

function normalizarCliente(item, favorecido) {
  return {
    favorecido:
      item?.favorecido ??
      item?.FAVORECIDO ??
      Number(favorecido),
    nome:
      item?.nome ??
      item?.NOME ??
      ''
  };
}

async function listarPedidosPorCliente(favorecido) {
  const baseUrl = process.env.LEGADO_BRIDGE_URL;

  if (!baseUrl) {
    throw new Error('Variável de ambiente LEGADO_BRIDGE_URL não configurada.');
  }

  const url = `${baseUrl.replace(/\/+$/, '')}/api/pedidos-cliente/${favorecido}`;

  const response = await fetch(url);
  let payload = null;

  try {
    payload = await response.json();
  } catch (error) {
    payload = null;
  }

  if (!response.ok) {
    throw new Error(
      payload?.detalhe ||
      payload?.mensagem ||
      `Falha ao consumir bridge local. HTTP ${response.status}`
    );
  }

  const dadosOriginais = Array.isArray(payload?.dados) ? payload.dados : [];
  const clienteOriginal = payload?.cliente || null;

  return {
    cliente: normalizarCliente(clienteOriginal, favorecido),
    dados: dadosOriginais.map(normalizarPedido)
  };
}

module.exports = {
  listarPedidosPorCliente
};
