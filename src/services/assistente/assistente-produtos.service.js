const produtoService = require('../produto/produto.service');

const STOPWORDS = new Set([
  'a', 'o', 'os', 'as', 'um', 'uma', 'uns', 'umas',
  'de', 'da', 'do', 'das', 'dos', 'para', 'pra', 'por',
  'quero', 'queria', 'preciso', 'manda', 'mande', 'me',
  'quanto', 'custa', 'custo', 'valor', 'preco', 'preço',
  'tem', 'produto', 'produtos', 'unidade', 'unidades',
  'peca', 'peça', 'pecas', 'peças', 'orçamento', 'orcamento'
]);

function limparTexto(valor) {
  if (valor === undefined || valor === null) {
    return '';
  }

  return String(valor).trim();
}

function normalizarTexto(valor) {
  return limparTexto(valor)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[º°ª]/g, '')
    .replace(/n[.\s]*([0-9]+)/g, 'n $1')
    .replace(/numero/g, 'n')
    .replace(/número/g, 'n')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokensBusca(termo) {
  const tokens = normalizarTexto(termo)
    .split(' ')
    .map((t) => t.trim())
    .filter(Boolean)
    .filter((t) => !STOPWORDS.has(t));

  return [...new Set(tokens)];
}

function normalizarQuantidade(valor) {
  if (valor === undefined || valor === null || `${valor}`.trim() === '') {
    return null;
  }

  const numero = Number.parseFloat(`${valor}`.replace(',', '.'));

  if (!Number.isFinite(numero) || numero <= 0) {
    return null;
  }

  return Math.round(numero * 1000) / 1000;
}

function normalizarPreco(valor) {
  if (valor === undefined || valor === null || `${valor}`.trim() === '') {
    return null;
  }

  const numero = Number.parseFloat(`${valor}`.replace(',', '.'));

  if (!Number.isFinite(numero)) {
    return null;
  }

  return Math.round(numero * 100) / 100;
}

function formatarMoeda(valor) {
  const numero = Number(valor);

  if (!Number.isFinite(numero)) {
    return null;
  }

  return numero.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  });
}

function pontuarProduto(produto, termo, tokens) {
  const nomeNormalizado = normalizarTexto(produto?.nome);
  const categoriaNormalizada = normalizarTexto(produto?.categoria);
  const textoProduto = `${nomeNormalizado} ${categoriaNormalizada}`.trim();
  const termoNormalizado = normalizarTexto(termo);

  if (!textoProduto) {
    return 0;
  }

  let score = 0;

  if (termoNormalizado && textoProduto.includes(termoNormalizado)) {
    score += 120;
  }

  if (termoNormalizado && termoNormalizado.includes(nomeNormalizado) && nomeNormalizado.length >= 4) {
    score += 80;
  }

  for (const token of tokens) {
    if (!token) continue;

    if (textoProduto.split(' ').includes(token)) {
      score += /^\d+$/.test(token) ? 30 : 18;
      continue;
    }

    if (textoProduto.includes(token)) {
      score += /^\d+$/.test(token) ? 16 : 8;
    }
  }

  return score;
}

function mapearProduto(produto, quantidade) {
  const preco = normalizarPreco(produto?.preco);
  const total = preco !== null && quantidade !== null
    ? Math.round(preco * quantidade * 100) / 100
    : null;

  return {
    id: produto?.id ?? null,
    nome: limparTexto(produto?.nome),
    categoria: limparTexto(produto?.categoria),
    preco,
    precoFormatado: formatarMoeda(preco),
    quantidade,
    total,
    totalFormatado: formatarMoeda(total),
    foto: produto?.foto ?? null,
    capacidadeCaixa: produto?.capacidade_caixa ?? produto?.capacidadeCaixa ?? null,
    itemLegado: produto?.item_legado ?? produto?.itemLegado ?? null
  };
}

function montarMensagem(produtos, quantidade, totalEncontrados) {
  if (!produtos.length) {
    return 'Não encontrei esse produto. Me diga o modelo ou tamanho.';
  }

  if (produtos.length === 1) {
    const produto = produtos[0];

    if (produto.precoFormatado && quantidade !== null && produto.totalFormatado) {
      return `${produto.nome}: ${produto.precoFormatado}. ${quantidade} unidade(s): ${produto.totalFormatado}.`;
    }

    if (produto.precoFormatado) {
      return `${produto.nome}: ${produto.precoFormatado}. Qual quantidade?`;
    }

    return `${produto.nome}: preço não cadastrado. Vou confirmar.`;
  }

  const lista = produtos
    .slice(0, 3)
    .map((produto, indice) => {
      const partes = [`${indice + 1}. ${produto.nome}`];

      if (produto.precoFormatado) {
        partes.push(produto.precoFormatado);
      }

      if (quantidade !== null && produto.totalFormatado) {
        partes.push(`${quantidade} unidade(s): ${produto.totalFormatado}`);
      }

      return partes.join(' - ');
    })
    .join('; ');

  if (totalEncontrados > 3) {
    return `Encontrei ${totalEncontrados} opções. Principais: ${lista}. Qual dessas?`;
  }

  return `Encontrei: ${lista}. Qual modelo?`;
}

async function consultarProduto({ termo, quantidade } = {}) {
  const termoLimpo = limparTexto(termo);
  const quantidadeNormalizada = normalizarQuantidade(quantidade);

  if (!termoLimpo) {
    return {
      ok: false,
      success: false,
      termo: '',
      quantidade: quantidadeNormalizada,
      encontrados: 0,
      produtos: [],
      mensagem_curta: 'Me diga o produto ou modelo.'
    };
  }

  const tokens = tokensBusca(termoLimpo);

  const produtosAtivos = await produtoService.listar({
    apenasAtivos: true
  });

  const ranqueados = produtosAtivos
    .map((produto) => ({
      produto,
      score: pontuarProduto(produto, termoLimpo, tokens)
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }

      return limparTexto(a.produto?.nome).localeCompare(limparTexto(b.produto?.nome), 'pt-BR');
    });

  const produtos = ranqueados
    .slice(0, 5)
    .map((item) => mapearProduto(item.produto, quantidadeNormalizada));

  return {
    ok: produtos.length > 0,
    success: true,
    termo: termoLimpo,
    quantidade: quantidadeNormalizada,
    encontrados: ranqueados.length,
    produtos,
    mensagem_curta: montarMensagem(produtos, quantidadeNormalizada, ranqueados.length)
  };
}

module.exports = {
  consultarProduto
};
