const pool = require('../../../db/connection');

// ===============================
// NORMALIZA TEXTO
// ===============================
function normalizarTexto(texto) {
  return (texto || '')
    .replace(/\uFFFD/g, '')
    .replace(/[\u{1F000}-\u{1FFFF}]/gu, '')
    .replace(/[\u{2600}-\u{27BF}]/gu, '')
    .replace(/[*_~]/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

// ===============================
// EXTRAI ITENS (FORMATO KIT + ORÇAMENTO)
// ===============================
function extrairItens(texto) {
  const itens = [];
  const normalizado = normalizarTexto(texto);

  // ===============================
  // FORMATO ORÇAMENTO
  // Ex:
  // • PRODUTO R$ 12,00 × 3 = R$ 36,00
  // ===============================
  const regexOrc = /•?\s*([^•\n]+?)\s+R\$\s*[\d.,]+\s*×\s*(\d+)/g;

  let match;
  while ((match = regexOrc.exec(normalizado)) !== null) {
    const nome = match[1].trim();
    const quantidade = parseInt(match[2]);

    if (nome) {
      itens.push({ nome, quantidade });
    }
  }

  // ===============================
  // FORMATO KIT
  // Ex:
  // - PRODUTO (x3)
  // ===============================
  const regexKit = /-\s*(.+?)\s*\(x(\d+)\)/g;

  while ((match = regexKit.exec(normalizado)) !== null) {
    const nome = match[1].trim();
    const quantidade = parseInt(match[2]);

    if (nome) {
      itens.push({ nome, quantidade });
    }
  }

  return itens;
}

// ===============================
// BUSCA PRODUTO NO BANCO
// ===============================
async function buscarProduto(nome) {
  const result = await pool.query(
    `
    SELECT nome, capacidade_caixa
    FROM produtos
    WHERE nome ILIKE $1
    LIMIT 1
    `,
    [`%${nome}%`]
  );

  return result.rows[0] || null;
}

// ===============================
// FUNÇÃO PRINCIPAL
// ===============================
async function calcular(texto, multiplicador = 1) {
  const itens = extrairItens(texto);

  if (itens.length === 0) {
    throw new Error('Nenhum produto encontrado no texto');
  }

  const naoEncontrados = [];
  const resultado = [];
  let somaVolumes = 0;

  for (const item of itens) {
    const produto = await buscarProduto(item.nome);

    if (!produto) {
      naoEncontrados.push(item.nome);
      continue;
    }

    const capacidade = Number(produto.capacidade_caixa);
    const quantidadeFinal = item.quantidade * multiplicador;

    // 🔥 REGRA: capacidade 0 = IGNORADO
    if (capacidade === 0) {
      resultado.push({
        produto: produto.nome,
        quantidade: item.quantidade,
        multiplicador,
        quantidade_final: quantidadeFinal,
        capacidade_caixa: 0,
        volumes: 'IGNORADO'
      });
      continue;
    }

    const volumes = quantidadeFinal / capacidade;
    somaVolumes += volumes;

    resultado.push({
      produto: produto.nome,
      quantidade: item.quantidade,
      multiplicador,
      quantidade_final: quantidadeFinal,
      capacidade_caixa: capacidade,
      volumes
    });
  }

  if (naoEncontrados.length > 0) {
    throw new Error(`Produtos não encontrados: ${naoEncontrados.join(', ')}`);
  }

  const total_volumes = Math.ceil(somaVolumes);

  return {
    itens: resultado,
    total_volumes,
    multiplicador
  };
}

module.exports = {
  normalizarTexto,
  extrairItens,
  buscarProduto,
  calcular
};
