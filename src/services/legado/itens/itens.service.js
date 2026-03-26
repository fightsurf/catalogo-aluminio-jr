const produtoService = require('../../produto/produto.service');

function limparTexto(valor) {
  if (typeof valor !== 'string') {
    return '';
  }

  return valor.trim();
}

function normalizarInteiroPositivo(valor, mensagem) {
  const numero = Number.parseInt(valor, 10);

  if (!Number.isInteger(numero) || numero <= 0) {
    throw new Error(mensagem);
  }

  return numero;
}

function normalizarPrecoProduto(valor) {
  if (valor === undefined || valor === null || `${valor}`.trim() === '') {
    throw new Error('Produto do Render sem preço válido para sincronismo.');
  }

  const numero = Number.parseFloat(`${valor}`.replace(',', '.'));

  if (!Number.isFinite(numero) || numero < 0) {
    throw new Error('Produto do Render sem preço válido para sincronismo.');
  }

  return Math.round(numero * 1000) / 1000;
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

function mapearTabelasPrecoAtualizadas(tabelas) {
  if (!Array.isArray(tabelas)) {
    return [];
  }

  return tabelas.map((linha) => ({
    produtoPrecoId: linha?.produtoPrecoId ?? linha?.produto_preco_id ?? null,
    tabelaPreco: linha?.tabelaPreco ?? linha?.tabela_preco ?? null,
    unidade: limparTexto(linha?.unidade),
    precoAnterior: linha?.precoAnterior === null || linha?.precoAnterior === undefined ? null : Number(linha.precoAnterior),
    precoAplicado: linha?.precoAplicado === null || linha?.precoAplicado === undefined ? null : Number(linha.precoAplicado)
  }));
}

function mapearItem(item) {
  return {
    item: item?.item ?? null,
    codigo: limparTexto(item?.codigo),
    descricao: limparTexto(item?.descricao),
    desativado: limparTexto(item?.desativado),
    produtoPrecoId: item?.produtoPrecoId ?? item?.produto_preco_id ?? null,
    tabelaPrecoAtual: item?.tabelaPrecoAtual ?? item?.tabela_preco_atual ?? null,
    unidadePrecoAtual: limparTexto(item?.unidadePrecoAtual ?? item?.unidade_preco_atual),
    precoAtual: item?.precoAtual === null || item?.precoAtual === undefined ? null : Number(item.precoAtual),
    precoPromocionalAtual: item?.precoPromocionalAtual === null || item?.precoPromocionalAtual === undefined
      ? null
      : Number(item.precoPromocionalAtual),
    descricaoOriginal: limparTexto(item?.descricaoOriginal),
    descricaoAplicada: limparTexto(item?.descricaoAplicada),
    descricaoTruncada: Boolean(item?.descricaoTruncada),
    precoOriginalInformado: item?.precoOriginalInformado === null || item?.precoOriginalInformado === undefined
      ? null
      : Number(item.precoOriginalInformado),
    precoAplicado: item?.precoAplicado === null || item?.precoAplicado === undefined
      ? null
      : Number(item.precoAplicado),
    tabelaPrecoAlterada: item?.tabelaPrecoAlterada ?? null,
    tabelaPrecoPrincipalUsada: item?.tabelaPrecoPrincipalUsada ?? item?.tabela_preco_principal_usada ?? null,
    precoPrincipalAnterior: item?.precoPrincipalAnterior === null || item?.precoPrincipalAnterior === undefined
      ? null
      : Number(item.precoPrincipalAnterior),
    quantidadeTabelasAtualizadas: item?.quantidadeTabelasAtualizadas ?? item?.quantidade_tabelas_atualizadas ?? 0,
    tabelasPrecoAtualizadas: mapearTabelasPrecoAtualizadas(item?.tabelasPrecoAtualizadas ?? item?.tabelas_preco_atualizadas)
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
  const itemNormalizado = normalizarInteiroPositivo(item, 'ITEM do legado inválido.');

  const response = await fetch(`${baseUrlLegado()}/api/itens/${encodeURIComponent(itemNormalizado)}`, {
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
  const itemNormalizado = normalizarInteiroPositivo(item, 'ITEM do legado inválido.');

  const response = await fetch(`${baseUrlLegado()}/api/itens/${encodeURIComponent(itemNormalizado)}/descricao`, {
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

async function atualizarPrecoItem({ item, preco }) {
  const itemNormalizado = normalizarInteiroPositivo(item, 'ITEM do legado inválido.');

  const response = await fetch(`${baseUrlLegado()}/api/itens/${encodeURIComponent(itemNormalizado)}/preco`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify({ preco })
  });

  const parsed = await lerJson(response);

  return {
    mensagem: parsed?.mensagem || 'Preços atualizados com sucesso em todas as tabelas.',
    dado: mapearItem(parsed?.dado || {})
  };
}

async function sincronizarDescricaoProduto({ produtoId, item }) {
  const produto = await produtoService.buscar(produtoId);

  if (!limparTexto(produto?.nome)) {
    throw new Error('Produto do Render sem nome válido para sincronismo.');
  }

  const precoProduto = normalizarPrecoProduto(produto?.preco);
  const itemNormalizado = normalizarInteiroPositivo(item, 'ITEM do legado inválido.');

  const response = await fetch(`${baseUrlLegado()}/api/itens/${encodeURIComponent(itemNormalizado)}/sincronizar-render`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify({
      descricao: produto.nome,
      preco: precoProduto
    })
  });

  const parsed = await lerJson(response);
  const dado = mapearItem(parsed?.dado || {});

  return {
    mensagem: parsed?.mensagem || 'Produto sincronizado com o item legado com sucesso.',
    produto: {
      id: produto.id,
      nome: limparTexto(produto.nome),
      preco: precoProduto,
      item_legado: produto?.item_legado ?? null
    },
    dado
  };
}

async function associarProdutoAoItemLegado({ produtoId, item }) {
  const produto = await produtoService.buscar(produtoId);
  const itemNormalizado = normalizarInteiroPositivo(item, 'ITEM do legado inválido.');

  if (!limparTexto(produto?.nome)) {
    throw new Error('Produto do Render sem nome válido para associação.');
  }

  normalizarPrecoProduto(produto?.preco);

  const produtoJaAssociado = await produtoService.buscarPorItemLegado(itemNormalizado, {
    ignorarProdutoId: produto.id
  });

  if (produtoJaAssociado) {
    throw new Error(`O ITEM legado ${itemNormalizado} já está associado ao produto "${limparTexto(produtoJaAssociado.nome) || `ID ${produtoJaAssociado.id}`}" (ID ${produtoJaAssociado.id}).`);
  }

  const atualizadoLegado = await sincronizarDescricaoProduto({
    produtoId: produto.id,
    item: itemNormalizado
  });

  const produtoAssociado = await produtoService.associarItemLegado(produto.id, itemNormalizado);

  return {
    mensagem: 'Associação concluída com sucesso.',
    produto: {
      id: produtoAssociado.id,
      nome: limparTexto(produtoAssociado.nome),
      preco: produtoAssociado?.preco === null || produtoAssociado?.preco === undefined ? null : Number(produtoAssociado.preco),
      item_legado: produtoAssociado.item_legado
    },
    dado: atualizadoLegado.dado
  };
}

async function desassociarProdutoDoItemLegado({ produtoId }) {
  const produto = await produtoService.buscar(produtoId);
  const itemAnterior = produto?.item_legado ?? null;

  const produtoDesassociado = await produtoService.desassociarItemLegado(produto.id);

  return {
    mensagem: itemAnterior
      ? `Produto desassociado do ITEM legado ${itemAnterior} com sucesso.`
      : 'Produto já estava sem ITEM legado associado.',
    produto: {
      id: produtoDesassociado.id,
      nome: limparTexto(produtoDesassociado.nome),
      preco: produtoDesassociado?.preco === null || produtoDesassociado?.preco === undefined ? null : Number(produtoDesassociado.preco),
      item_legado: produtoDesassociado.item_legado ?? null
    },
    itemAnterior
  };
}

async function transferirAssociacaoProdutoAoItemLegado({ produtoId, item }) {
  const produtoDestino = await produtoService.buscar(produtoId);
  const itemNormalizado = normalizarInteiroPositivo(item, 'ITEM do legado inválido.');

  if (!limparTexto(produtoDestino?.nome)) {
    throw new Error('Produto do Render sem nome válido para transferência.');
  }

  normalizarPrecoProduto(produtoDestino?.preco);

  const produtoOrigem = await produtoService.buscarPorItemLegado(itemNormalizado, {
    ignorarProdutoId: produtoDestino.id
  });

  const atualizadoLegado = await sincronizarDescricaoProduto({
    produtoId: produtoDestino.id,
    item: itemNormalizado
  });

  const transferencia = await produtoService.transferirItemLegado(produtoDestino.id, itemNormalizado);

  return {
    mensagem: produtoOrigem
      ? `ITEM legado ${itemNormalizado} transferido do produto "${limparTexto(produtoOrigem.nome) || `ID ${produtoOrigem.id}`}" para "${limparTexto(produtoDestino.nome) || `ID ${produtoDestino.id}`}" com sucesso.`
      : 'Associação atribuída com sucesso.',
    produto: {
      id: transferencia.produto.id,
      nome: limparTexto(transferencia.produto.nome),
      preco: transferencia.produto?.preco === null || transferencia.produto?.preco === undefined ? null : Number(transferencia.produto.preco),
      item_legado: transferencia.produto.item_legado
    },
    produtoAnterior: transferencia.produtoAnterior
      ? {
          id: transferencia.produtoAnterior.id,
          nome: limparTexto(transferencia.produtoAnterior.nome),
          preco: transferencia.produtoAnterior?.preco === null || transferencia.produtoAnterior?.preco === undefined ? null : Number(transferencia.produtoAnterior.preco),
          item_legado: transferencia.produtoAnterior.item_legado ?? null
        }
      : null,
    dado: atualizadoLegado.dado
  };
}

module.exports = {
  listarItens,
  buscarItem,
  atualizarDescricaoItem,
  atualizarPrecoItem,
  sincronizarDescricaoProduto,
  associarProdutoAoItemLegado,
  desassociarProdutoDoItemLegado,
  transferirAssociacaoProdutoAoItemLegado
};
