const produtoService = require('../../produto/produto.service');

function getBridgeBaseUrl() {
  return (
    process.env.LEGADO_BRIDGE_URL ||
    process.env.LEGACY_FIREBIRD_API_URL ||
    ''
  ).replace(/\/$/, '');
}

function limparTexto(valor) {
  if (valor === undefined || valor === null) {
    return '';
  }

  return String(valor).trim();
}

function normalizarNumero(valor, nomeCampo) {
  const numero = Number(valor);

  if (!Number.isFinite(numero)) {
    throw new Error(`Campo inválido: ${nomeCampo}`);
  }

  return numero;
}

function normalizarInteiroPositivo(valor, nomeCampo) {
  const numero = Number(valor);

  if (!Number.isInteger(numero) || numero <= 0) {
    throw new Error(`Campo inválido: ${nomeCampo}`);
  }

  return numero;
}

async function resolverItemDoLegado(itemEntrada, indice) {
  const produtoId = itemEntrada?.produto_id ?? itemEntrada?.produtoId;

  if (produtoId === undefined || produtoId === null || String(produtoId).trim() === '') {
    const itemLegado = itemEntrada?.item;
    const descricao = limparTexto(itemEntrada?.descricao);

    if (!itemLegado || !descricao) {
      throw new Error(`Item ${indice + 1}: informe produto_id ou item/descricao do legado.`);
    }

    return {
      item: normalizarInteiroPositivo(itemLegado, `itens[${indice}].item`),
      descricao,
      quantidade: normalizarNumero(itemEntrada?.quantidade, `itens[${indice}].quantidade`),
      preco: normalizarNumero(itemEntrada?.preco, `itens[${indice}].preco`)
    };
  }

  const produto = await produtoService.buscar(produtoId);
  const itemLegado = produto?.item_legado;

  if (!itemLegado) {
    throw new Error(`Produto "${limparTexto(produto?.nome) || `ID ${produtoId}`}" está sem vínculo com item do legado.`);
  }

  return {
    item: normalizarInteiroPositivo(itemLegado, `itens[${indice}].produto_id`),
    descricao: limparTexto(produto?.nome) || `Produto ${produtoId}`,
    quantidade: normalizarNumero(itemEntrada?.quantidade, `itens[${indice}].quantidade`),
    preco: normalizarNumero(itemEntrada?.preco, `itens[${indice}].preco`)
  };
}

async function prepararPayloadLegado(payload = {}) {
  const itensEntrada = Array.isArray(payload?.itens) ? payload.itens : [];

  if (!itensEntrada.length) {
    throw new Error('Informe ao menos 1 item para o pedido.');
  }

  const itens = [];

  for (let i = 0; i < itensEntrada.length; i += 1) {
    const itemResolvido = await resolverItemDoLegado(itensEntrada[i], i);

    if (itemResolvido.quantidade <= 0) {
      throw new Error(`Item ${i + 1}: quantidade deve ser maior que zero.`);
    }

    if (itemResolvido.preco < 0) {
      throw new Error(`Item ${i + 1}: preço não pode ser negativo.`);
    }

    itens.push(itemResolvido);
  }

    const carradaCodigoBruto = payload?.carrada_codigo ?? payload?.carradaCodigo ?? null;
  const carradaCodigo =
    carradaCodigoBruto === undefined || carradaCodigoBruto === null || String(carradaCodigoBruto).trim() === ''
      ? null
      : normalizarInteiroPositivo(carradaCodigoBruto, 'carrada_codigo');

  return {
    data: payload?.data,
    favorecido: payload?.favorecido,
    obs: payload?.obs,
    vendedor: payload?.vendedor,
    volumes: payload?.volumes,
    total: payload?.total,
    carrada_codigo: carradaCodigo,
    itens
  };
}

async function inserirPedido(payload) {
  const baseUrl = getBridgeBaseUrl();

  if (!baseUrl) {
    throw new Error('LEGADO_BRIDGE_URL ou LEGACY_FIREBIRD_API_URL não configurada.');
  }

  const payloadLegado = await prepararPayloadLegado(payload);

  const response = await fetch(`${baseUrl}/api/pedidos-insercao-v2`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payloadLegado)
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data?.detalhe || data?.erro || `Falha HTTP ${response.status}`);
  }

  return data;
}

module.exports = {
  inserirPedido
};
