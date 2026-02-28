const pool = require('../../../db/connection');

// Normalizar texto (remover emojis, caracteres especiais, etc)
function normalizarTexto(texto) {
  return texto
    // Converter • em quebras de linha PRIMEIRO
    .replace(/•/g, '\n')
    // Remover emojis
    .replace(/[\u{1F000}-\u{1FFFF}]/gu, '')
    .replace(/[\u{2600}-\u{27BF}]/gu, '')
    // Remover caracteres de formatação
    .replace(/[*_~]/g, '')
    // Limpar múltiplos espaços
    .replace(/[ \t]+/g, ' ')
    // Trim e remover linhas vazias
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
    // FORMATO ORÇAMENTO: contém ×
    if (linha.includes('×')) {
      const partes = linha.split('×');
      const esquerda = partes[0];
      const direita = partes[1] || '';

      // Extrair quantidade da direita
      const qtyMatch = direita.match(/(\d+)/);
      if (!qtyMatch) continue;
      const quantidade = parseInt(qtyMatch[1]);

      // Limpar nome (remover preço)
      const nome = esquerda
        .replace(/R\$[\s\d.,]+$/, '')
        .replace(/[,;:•]+$/, '')
        .trim();

      if (nome) itens.push({ nome, quantidade });
      continue;
    }

    // FORMATO KIT: contém +
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
  let somaVolumes = 0;

  for (const item of itens) {
    const produto = await buscarProduto(item.nome);

    if (!produto) {
      naoEncontrados.push(item.nome);
      continue;
    }

    // Ignorar produtos com capacidade_caixa = 0
    if (produto.capacidade_caixa === 0) continue;

    // Manter DECIMAL para cada produto
    const volumes = item.quantidade / produto.capacidade_caixa;
    somaVolumes += volumes;

    resultado.push({
      produto: produto.nome,
      quantidade: item.quantidade,
      capacidade_caixa: produto.capacidade_caixa,
      volumes  // ← DECIMAL (ex: 1.4, 2.0)
    });
  }

  if (naoEncontrados.length > 0) {
    throw new Error(`Produtos não encontrados: ${naoEncontrados.join(', ')}`);
  }

  // Arredondar APENAS o total final
  const total_volumes = Math.ceil(somaVolumes);

  return { itens: resultado, total_volumes };
}

module.exports = { normalizarTexto, extrairItens, buscarProduto, calcular };