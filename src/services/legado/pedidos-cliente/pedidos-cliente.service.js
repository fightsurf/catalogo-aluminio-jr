function numeroSeguro(valor) {
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : 0;
}

function textoSeguro(valor) {
  if (valor === undefined || valor === null) {
    return '';
  }

  return String(valor).trim();
}

function normalizarPedido(item) {
  const total = numeroSeguro(item.total ?? item.TOTAL);
  const totalPago = numeroSeguro(item.totalPago ?? item.total_pago ?? item.TOTAL_PAGO);
  const saldoInformado = item.saldoRestante ?? item.saldo_restante ?? item.SALDO_RESTANTE;
  const saldoRestante = saldoInformado === undefined || saldoInformado === null
    ? Number((total - totalPago).toFixed(2))
    : numeroSeguro(saldoInformado);

  return {
    empresa: item.empresa ?? item.EMPRESA ?? -1,
    saida: item.saida ?? item.SAIDA ?? null,
    pdv: item.pdv ?? item.PDV ?? 0,
    numero: item.numero ?? item.NUMERO ?? null,
    data: item.data ?? item.DATA ?? null,
    total,
    totalPago: Number(totalPago.toFixed(2)),
    saldoRestante: Number(saldoRestante.toFixed(2)),
    favorecido: item.favorecido ?? item.FAVORECIDO ?? null,
    clienteNome: textoSeguro(item.clienteNome ?? item.cliente_nome ?? item.CLIENTE_NOME),
    clienteTelefone1: textoSeguro(item.clienteTelefone1 ?? item.cliente_telefone1 ?? item.CLIENTE_TELEFONE1),
    clienteTelefonePrincipal: textoSeguro(item.clienteTelefonePrincipal ?? item.cliente_telefone_principal ?? item.CLIENTE_TELEFONE_PRINCIPAL),
    carradaCodigo: item.carradaCodigo ?? item.carrada_codigo ?? item.CARRADA_CODIGO ?? null,
    carradaData: item.carradaData ?? item.carrada_data ?? item.CARRADA_DATA ?? null,
    carradaDescricao: textoSeguro(item.carradaDescricao ?? item.carrada_descricao ?? item.CARRADA_DESCRICAO),
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
