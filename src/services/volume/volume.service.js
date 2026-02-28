const pool = require('../../../db/connection');

// Normalizar texto (remover emojis, caracteres especiais, etc)
function normalizarTexto(texto) {
  return (texto || '')
    // Remover caracteres invisíveis comuns do WhatsApp / cópia
    .replace(/\uFFFD/g, '')
    // Converter • em quebras de linha PRIMEIRO
    .replace(/•/g, '\n')
    // Remover emojis (faixas comuns)
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
    const l = (linha || '').toLowerCase();

    // Ignorar cabeçalhos e totais do orçamento
    if (l.includes('orçamento') || l.includes('orcamento') || l.includes('valor total')) {
      continue;
    }

    // FORMATO ORÇAMENTO: contém × (ou x/X)
    if (linha.includes('×') || /\sx\s/i.test(linha)) {
      // Separar nome e quantidade
      const partes = linha.includes('×') ? linha.split('×') : linha.split(/\sx\s/i);
      const esquerda = partes[0] || '';
      const direita = partes[1] || '';

      // Extrair quantidade da direita
      const qtyMatch = direita.match(/(\d+)/);
      if (!qtyMatch) continue;
      const quantidade = parseInt(qtyMatch[1]);

      // Nome = tudo antes do primeiro "R$" (mais robusto)
      const nome = esquerda
        .split('R$')[0]
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

    // FORMATO KIT FEIRINHA: contém (x1), (x2), etc
    const kitMatch = linha.match(/\(x(\d+)\)/);
    if (kitMatch) {
      const quantidade = parseInt(kitMatch[1]);
      const nome = linha
        .replace(/\(x\d+\)/g, '')
        .replace(/^-\s*/, '')
        .trim();

      if (nome) itens.push({ nome, quantidade });
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

    // Ignorar produtos com capacidade_caixa = 0
    if (produto.capacidade_caixa === 0) continue;

    // Multiplicar quantidade pelo multiplicador
    const quantidadeFinal = item.quantidade * multiplicador;

    // Manter DECIMAL para cada produto
    const volumes = quantidadeFinal / produto.capacidade_caixa;
    somaVolumes += volumes;

    resultado.push({
      produto: produto.nome,
      quantidade: item.quantidade,
      multiplicador: multiplicador,
      quantidade_final: quantidadeFinal,
      capacidade_caixa: produto.capacidade_caixa,
      volumes
    });
  }

  if (naoEncontrados.length > 0) {
    throw new Error(`Produtos não encontrados: ${naoEncontrados.join(', ')}`);
  }

  // Arredondar APENAS o total final
  const total_volumes = Math.ceil(somaVolumes);

  return { itens: resultado, total_volumes, multiplicador };
}

module.exports = { normalizarTexto, extrairItens, buscarProduto, calcular };