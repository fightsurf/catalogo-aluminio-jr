const pool = require('../../../db/connection');

// Normalizar texto (remover emojis, caracteres especiais, etc)
function normalizarTexto(texto) {
  return texto
    // Remover emojis e outros caracteres Unicode não-básicos
    .replace(/[\u{1F000}-\u{1FFFF}]/gu, '')
    .replace(/[\u{2600}-\u{27BF}]/gu, '')
    // Remover caracteres de formatação do WhatsApp
    .replace(/[*_~]/g, '')
    // Remover marcadores de lista
    .replace(/^[•\-]\s*/gm, '')
    // Remover múltiplos espaços
    .replace(/[ \t]+/g, ' ')
    // Trim de cada linha e remover linhas vazias
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0)
    .join('\n');
}

// Extrair itens do texto normalizado
function extrairItens(texto) {
  const itens = [];
  const normalizado = normalizarTexto(texto);
  const linhas = normalizado.split('\n');

  for (const linha of linhas) {
    // FORMATO ORÇAMENTO: contém × (ex: BALDE 8L PLASTICO R$ 10,94 × 9 = R$ 98,46)
    if (linha.includes('×')) {
      const partes = linha.split('×');
      const esquerda = partes[0];
      const direita = partes[1] || '';

      const qtyMatch = direita.match(/(\d+)/);
      if (!qtyMatch) continue;
      const quantidade = parseInt(qtyMatch[1]);

      const nome = esquerda
        .replace(/R\$[\s\d.,]+$/, '')
        .replace(/[,;:•]+$/, '')
        .trim();

      if (nome) itens.push({ nome, quantidade });
      continue;
    }

    // FORMATO com quantidade: (x10) | x10 | 10x
    const QTY_INLINE_RE = /\(x(?<paren>\d+)\)|(?<!\d)x(?<prefix>\d+)|(?<suffix>\d+)x(?!\d)/i;
    const qtyInlineMatch = linha.match(QTY_INLINE_RE);

    // FORMATO "quantidade N" ou "qtd N"
    const qtyTextMatch = linha.match(/(?:quantidade|qtd)[:\s]+(\d+)/i);

    if (qtyInlineMatch || qtyTextMatch) {
      const quantidade = qtyInlineMatch
        ? parseInt(qtyInlineMatch.groups.paren || qtyInlineMatch.groups.prefix || qtyInlineMatch.groups.suffix)
        : parseInt(qtyTextMatch[1]);

      // FORMATO KIT: contém + (ex: CAÇAROLA 16 + TAMPA ALUMÍNIO (x1))
      if (linha.includes('+')) {
        const produtos = linha.split('+');
        for (const produto of produtos) {
          const nome = produto
            .replace(/\(x\d+\)/gi, '')
            .replace(/(?<!\d)x\d+|\d+x(?!\d)/gi, '')
            .replace(/(?:quantidade|qtd)[:\s]+\d+/gi, '')
            .replace(/[\s,;:]+$/, '')
            .trim();
          if (nome) itens.push({ nome, quantidade });
        }
        continue;
      }

      const nome = linha
        .replace(/\(x\d+\)/gi, '')
        .replace(/(?<!\d)x\d+|\d+x(?!\d)/gi, '')
        .replace(/(?:quantidade|qtd)[:\s]+\d+/gi, '')
        .replace(/[\s,;:]+$/, '')
        .trim();

      if (nome) itens.push({ nome, quantidade });
      continue;
    }

    // FORMATO KIT sem quantidade explícita: contém +
    if (linha.includes('+')) {
      const produtos = linha.split('+');
      for (const produto of produtos) {
        const nome = produto.trim();
        if (nome) itens.push({ nome, quantidade: 1 });
      }
      continue;
    }
  }

  return itens;
}

// Buscar produto no banco
async function buscarProduto(nome) {
  const result = await pool.query(
    `SELECT nome, capacidade_caixa FROM produtos WHERE nome ILIKE $1 LIMIT 1`,
    [`%${nome}%`]
  );
  return result.rows[0] || null;
}

// Calcular volumes
async function calcular(texto) {
  const itens = extrairItens(texto);

  if (itens.length === 0) {
    throw new Error('Nenhum produto encontrado no texto');
  }

  const naoEncontrados = [];
  const resultado = [];

  for (const item of itens) {
    const produto = await buscarProduto(item.nome);

    if (!produto) {
      naoEncontrados.push(item.nome);
      continue;
    }

    // Ignorar produtos com capacidade_caixa = 0
    if (produto.capacidade_caixa === 0) continue;

    const volumes = Math.ceil(item.quantidade / produto.capacidade_caixa);

    resultado.push({
      produto: produto.nome,
      quantidade: item.quantidade,
      capacidade_caixa: produto.capacidade_caixa,
      volumes
    });
  }

  if (naoEncontrados.length > 0) {
    throw new Error(`Produtos não encontrados: ${naoEncontrados.join(', ')}`);
  }

  const total_volumes = resultado.reduce((acc, i) => acc + i.volumes, 0);

  return { itens: resultado, total_volumes };
}

module.exports = { normalizarTexto, extrairItens, buscarProduto, calcular };
