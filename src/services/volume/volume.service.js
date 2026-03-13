const pool = require('../../../db/connection');

// ===============================
// EXTRAI ITENS DO TEXTO PADRONIZADO
// ===============================
function extrairItens(texto) {
  const itens = [];

  if (!texto) return itens;

  // 🔥 Limpeza pesada contra WhatsApp
  texto = texto
    .replace(/\uFFFD/g, '') // remove caractere inválido
    .replace(/[^\x20-\x7EÀ-ÿ\n]/g, '') // remove lixo invisível
    .replace(/\r/g, '');

  /*
    Aceita formatos como:

    • PRODUTO | QTD: 1
    * PRODUTO |QTD:1
    - PRODUTO | QTD: 1
    . PRODUTO | QTD:1
  */

  const regex = /(?:^|\n)[^\S\r\n]*[*•\-.]?\s*(.+?)\s*\|\s*QTD:\s*(\d+)/gi;

  let match;

  while ((match = regex.exec(texto)) !== null) {
    const nome = match[1]
      .replace(/^[*•\-.]\s*/, '') // remove marcador residual
      .trim();

    const quantidade = parseInt(match[2]);

    if (nome && !isNaN(quantidade)) {
      itens.push({ nome, quantidade });
    }
  }

  return itens;
}

// ===============================
// BUSCA PRODUTO
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
// CÁLCULO PRINCIPAL
// ===============================
async function calcular({ texto, itens, multiplicador = 1 }) {

  let listaItens = [];

  if (Array.isArray(itens) && itens.length > 0) {
    listaItens = itens;
  } else if (texto) {
    listaItens = extrairItens(texto);
  }

  if (!listaItens || listaItens.length === 0) {
    throw new Error('Nenhum produto encontrado no texto');
  }

  const naoEncontrados = [];
  const resultado = [];
  let somaVolumes = 0;

  for (const item of listaItens) {
    const produto = await buscarProduto(item.nome);

    if (!produto) {
      naoEncontrados.push(item.nome);
      continue;
    }

    const capacidade = Number(produto.capacidade_caixa);
    const quantidadeFinal = Number(item.quantidade) * multiplicador;

    // 🔥 Capacidade 0 = IGNORADO
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
  calcular
};
