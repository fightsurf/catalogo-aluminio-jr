const produtoService = require('../../produto/produto.service');

function limparTexto(valor) {
  if (typeof valor !== 'string') {
    return '';
  }

  return valor.trim();
}

function baseUrlLegado() {
  const baseUrl = limparTexto(process.env.LEGADO_BRIDGE_URL);

  if (!baseUrl) {
    throw new Error('LEGADO_BRIDGE_URL não configurada.');
  }

  return baseUrl.replace(/\/+$/, '');
}

function montarUrlItens(filtros = {}) {
  const url = new URL(`${baseUrlLegado()}/api/itens`);

  if (limparTexto(filtros.descricao)) {
    url.searchParams.set('descricao', limparTexto(filtros.descricao));
  }

  if (
    filtros.limite !== undefined &&
    filtros.limite !== null &&
    `${filtros.limite}` !== ''
  ) {
    url.searchParams.set('limite', `${filtros.limite}`);
  }

  return url.toString();
}

async function lerJson(response) {
  const rawBody = await response.text();

  let parsed = {};

  try {
    parsed = rawBody ? JSON.parse(rawBody) : {};
  } catch (error) {
    throw new Error(`API local não respondeu JSON válido. Corpo recebido: ${rawBody}`);
  }

  if (!response.ok) {
    throw new Error(parsed?.detalhe || parsed?.erro || `API local respondeu com status ${response.status}.`);
  }

  return parsed;
}

function mapearItem(item) {
  return {
    item: item?.item ?? null,
    codigo: limparTexto(item?.codigo),
    descricao: limparTexto(item?.descricao),
    desativado: limparTexto(item?.desativado),
    descricaoOriginal: limparTexto(item?.descricaoOriginal),
    descricaoAplicada: limparTexto(item?.descricaoAplicada),
    descricaoTruncada: Boolean(item?.descricaoTruncada)
  };
}

async function listarItens(filtros = {}) {
  const response = await fetch(montarUrlItens(filtros), {
    method: 'GET',
    headers: {
      Accept: 'application/json'
    }
  });

  const parsed = await lerJson(response);
  const dados = Array.isArray(parsed?.dados) ? parsed.dados.map(mapearItem) : [];

  return {
    total: parsed?.total ?? dados.length,
    dados
  };
}

async function buscarItem(item) {
  const response = await fetch(`${baseUrlLegado()}/api/itens/${encodeURIComponent(item)}`, {
    method: 'GET',
    headers: {
      Accept: 'application/json'
    }
  });

  const parsed = await lerJson(response);

  return {
    dado: mapearItem(parsed?.dado || {})
  };
}

async function atualizarDescricaoItem({ item, descricao }) {
  const response = await fetch(`${baseUrlLegado()}/api/itens/${encodeURIComponent(item)}/descricao`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify({ descricao })
  });

  const parsed = await lerJson(response);

  return {
    mensagem: parsed?.mensagem || 'Descrição atualizada com sucesso.',
    dado: mapearItem(parsed?.dado || {})
  };
}

async function sincronizarDescricaoProduto({ produtoId, item }) {
  const produto = await produtoService.buscar(produtoId);

  if (!limparTexto(produto?.nome)) {
    throw new Error('Produto do Render sem nome válido para sincronismo.');
  }

  const atualizado = await atualizarDescricaoItem({
    item,
    descricao: produto.nome
  });

  return {
    mensagem: 'Produto sincronizado com o item legado com sucesso.',
    produto: {
      id: produto.id,
      nome: limparTexto(produto.nome)
    },
    dado: atualizado.dado
  };
}

module.exports = {
  listarItens,
  buscarItem,
  atualizarDescricaoItem,
  sincronizarDescricaoProduto
};
