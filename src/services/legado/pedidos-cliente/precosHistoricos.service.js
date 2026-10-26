const legadoBridgeService = require('../legadoBridge.service');

// Usa os endpoints existentes do bridge local, sem exigir alteração no Firebird.
// A leitura dos pedidos de cada cliente é compartilhada entre os produtos abertos.
const cacheClientes = new Map();
const consultasPendentes = new Map();
const TTL_MS = 5 * 60 * 1000;
const MAX_CLIENTES_CACHE = 20;
const CONCORRENCIA_BRIDGE = 5;

function inteiroPositivo(valor) {
  const n = Number(valor);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

function normalizarNome(valor) {
  return String(valor ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function obterItens(resposta) {
  if (Array.isArray(resposta?.data?.itens)) return resposta.data.itens;
  if (Array.isArray(resposta?.dados?.itens)) return resposta.dados.itens;
  if (Array.isArray(resposta?.data)) return resposta.data;
  throw new Error('A consulta de itens de um pedido retornou formato inesperado.');
}

function normalizarRegistro(item, pedido) {
  const bruto = item?.preco ?? item?.PRECO;
  if (bruto === null || bruto === undefined || bruto === '') return null;
  const preco = Number(bruto);
  if (!Number.isFinite(preco) || preco < 0) return null;

  return {
    item: inteiroPositivo(item?.item ?? item?.ITEM),
    descricao: String(item?.descricao ?? item?.DESCRICAO ?? '').trim(),
    preco,
    quantidade: Number(item?.quantidade ?? item?.QUANTIDADE ?? 0),
    data: pedido?.data ?? pedido?.DATA ?? null,
    pedidoNumero: pedido?.numero ?? pedido?.NUMERO ?? null,
    saida: inteiroPositivo(pedido?.saida ?? pedido?.SAIDA)
  };
}

async function carregarTodosPedidos(favorecido, get) {
  const resposta = await get(`/api/pedidos-cliente/${favorecido}`);
  if (!Array.isArray(resposta?.dados)) {
    throw new Error('O histórico de pedidos do cliente retornou formato inesperado.');
  }

  // Pedidos cancelados não representam compras válidas.
  const pedidos = resposta.dados.filter(pedido => {
    const situacao = String(pedido?.situacao ?? pedido?.SITUACAO ?? '').trim().toUpperCase();
    return situacao !== 'C' && situacao !== 'CANCELADO' && situacao !== 'CANCELADA';
  });

  const registrosPorPedido = new Array(pedidos.length);
  let proximo = 0;
  async function executar() {
    while (proximo < pedidos.length) {
      const indice = proximo++;
      const pedido = pedidos[indice];
      const saida = inteiroPositivo(pedido?.saida ?? pedido?.SAIDA);
      if (!saida) throw new Error('Pedido sem identificador SAIDA: histórico incompleto.');

      const respostaItens = await get(`/api/legado/pedidos/${saida}/itens`);
      const itens = obterItens(respostaItens);
      registrosPorPedido[indice] = itens
        .map(item => normalizarRegistro(item, pedido))
        .filter(Boolean);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCORRENCIA_BRIDGE, pedidos.length) }, () => executar())
  );
  return registrosPorPedido.flat();
}

async function obterHistoricoCliente(favorecido, get) {
  if (get !== legadoBridgeService.get) return carregarTodosPedidos(favorecido, get);

  const agora = Date.now();
  const existente = cacheClientes.get(favorecido);
  if (existente && existente.expiraEm > agora) return existente.registros;
  if (consultasPendentes.has(favorecido)) return consultasPendentes.get(favorecido);

  const promessa = carregarTodosPedidos(favorecido, get);
  consultasPendentes.set(favorecido, promessa);
  try {
    const registros = await promessa;
    cacheClientes.delete(favorecido);
    cacheClientes.set(favorecido, { registros, expiraEm: Date.now() + TTL_MS });
    while (cacheClientes.size > MAX_CLIENTES_CACHE) {
      cacheClientes.delete(cacheClientes.keys().next().value);
    }
    return registros;
  } finally {
    consultasPendentes.delete(favorecido);
  }
}

function ordenarMaisRecente(a, b) {
  const dataA = String(a.data || '');
  const dataB = String(b.data || '');
  const timestampA = Date.parse(dataA);
  const timestampB = Date.parse(dataB);
  if (Number.isFinite(timestampA) && Number.isFinite(timestampB)) {
    return timestampB - timestampA || Number(b.saida || 0) - Number(a.saida || 0);
  }
  return dataB.localeCompare(dataA) || Number(b.saida || 0) - Number(a.saida || 0);
}

async function buscarPrecosHistoricos(favorecido, produto = {}, { get = legadoBridgeService.get } = {}) {
  const clienteId = inteiroPositivo(favorecido);
  if (!clienteId) {
    const erro = new Error('Código do cliente inválido.');
    erro.statusCode = 400;
    throw erro;
  }

  const codigo = inteiroPositivo(produto.item);
  const descricao = String(produto.descricao ?? '').trim().slice(0, 250);
  if (!codigo && !descricao) {
    const erro = new Error('Informe o código ou descrição do produto.');
    erro.statusCode = 400;
    throw erro;
  }

  const todos = await obterHistoricoCliente(clienteId, get);
  let registros = codigo ? todos.filter(registro => registro.item === codigo) : [];

  // Fallback para perfis do bridge que retornam apenas a descrição do produto.
  if (!registros.length && descricao) {
    const nome = normalizarNome(descricao);
    registros = todos.filter(registro => normalizarNome(registro.descricao) === nome);
  }

  return {
    item: codigo,
    descricao,
    precos: registros.slice().sort(ordenarMaisRecente).map(registro => ({
      preco: registro.preco,
      data: registro.data,
      pedidoNumero: registro.pedidoNumero,
      quantidade: Number.isFinite(registro.quantidade) ? registro.quantidade : 0,
      saida: registro.saida
    }))
  };
}

module.exports = { buscarPrecosHistoricos };
