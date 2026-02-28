const pool = require('../../../db/connection');

function parseTexto(texto) {
  const itens = [];

  const linhas = texto.split('\n');

  for (const linhaRaw of linhas) {
    const linha = linhaRaw.trim();
    if (!linha) continue;

    // FORMATO ORÇAMENTO: contém × (ex: • BALDE 8L PLASTICO R$ 10,94 × 9 = *R$ 98,46*)
    if (linha.includes('×')) {
      const partes = linha.split('×');
      const esquerda = partes[0];
      const direita = partes[1] || '';

      const qtyMatch = direita.match(/(\d+)/);
      if (!qtyMatch) continue;
      const quantidade = parseInt(qtyMatch[1]);

      let nome = esquerda
        .replace(/^[-•\s]+/, '')
        .replace(/R\$[\s\d.,]+$/, '')
        .trim();

      if (nome) itens.push({ nome, quantidade });
      continue;
    }

    // FORMATO KIT: contém + (ex: - CAÇAROLA 16 + TAMPA ALUMÍNIO (x1))
    if (linha.includes('+')) {
      const qtyMatch = linha.match(/\(x(\d+)\)/i);
      const quantidade = qtyMatch ? parseInt(qtyMatch[1]) : 1;

      const produtos = linha.split('+');
      for (const produto of produtos) {
        const nome = produto
          .replace(/^[-•\s]+/, '')
          .replace(/\(x\d+\)/i, '')
          .trim();
        if (nome) itens.push({ nome, quantidade });
      }
      continue;
    }
  }

  return itens;
}

async function calcular(texto) {
  const itens = parseTexto(texto);

  if (itens.length === 0) {
    throw new Error('Nenhum produto encontrado no texto');
  }

  const naoEncontrados = [];
  const resultado = [];

  for (const item of itens) {
    const result = await pool.query(
      `SELECT nome, capacidade_caixa FROM produtos WHERE nome ILIKE $1 LIMIT 1`,
      [`%${item.nome}%`]
    );

    if (result.rows.length === 0) {
      naoEncontrados.push(item.nome);
      continue;
    }

    const produto = result.rows[0];

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

module.exports = { calcular };
