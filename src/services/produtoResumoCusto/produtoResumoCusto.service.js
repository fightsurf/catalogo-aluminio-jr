const pool = require('../../../db/connection');

function moedaNumero(value) {
  return Number(value || 0);
}

function normalizarTexto(value) {
  return String(value || '').trim();
}

function mapearProduto(row) {
  const custo = moedaNumero(row.custo);
  const precoVenda = moedaNumero(row.preco_venda);
  const lucro = Number((precoVenda - custo).toFixed(4));
  const totalItens = Number(row.total_itens || 0);
  const semComposicao = !row.composicao_id;
  const custoZerado = custo <= 0;
  const lucroNegativo = lucro < 0;
  const erro = custoZerado || lucroNegativo;

  return {
    produto_id: Number(row.produto_id),
    produto: row.produto,
    composicao_id: row.composicao_id ? Number(row.composicao_id) : null,
    custo,
    preco_venda: precoVenda,
    lucro,
    total_itens: totalItens,
    sem_composicao: semComposicao,
    custo_zerado: custoZerado,
    lucro_negativo: lucroNegativo,
    erro
  };
}

async function listar(filtros = {}) {
  const values = [];
  const conditions = [];

  if (filtros.busca) {
    values.push(`%${normalizarTexto(filtros.busca)}%`);
    conditions.push(`p.nome ILIKE $${values.length}`);
  }

  const apenasAtivos = filtros.ativos === undefined || filtros.ativos === 'true' || filtros.ativos === true;
  if (apenasAtivos) {
    conditions.push('p.ativo = TRUE');
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const result = await pool.query(`
    SELECT
      p.id AS produto_id,
      p.nome AS produto,
      p.preco AS preco_venda,
      pc.id AS composicao_id,
      COUNT(pci.id)::int AS total_itens,
      COALESCE(SUM(
        pci.quantidade *
        CASE
          WHEN d.insumo_id IS NOT NULL THEN COALESCE(d.peso_kg, 0) * COALESCE(ifn.custo_final, 0)
          ELSE COALESCE(ifn.custo_final, 0)
        END
      ), 0)::numeric(14,4) AS custo
    FROM produtos p
    LEFT JOIN produtos_composicoes pc ON pc.produto_id = p.id
    LEFT JOIN produtos_composicoes_itens pci ON pci.composicao_id = pc.id
    LEFT JOIN insumos_fornecedores ifn ON ifn.id = pci.insumo_fornecedor_id
    LEFT JOIN insumos i ON i.id = ifn.insumo_id
    LEFT JOIN insumos_discos d ON d.insumo_id = i.id
    ${where}
    GROUP BY p.id, p.nome, p.preco, pc.id
    ORDER BY p.nome ASC
  `, values);

  let produtos = result.rows.map(mapearProduto);

  const status = filtros.status || 'todos';
  if (status === 'erro') {
    produtos = produtos.filter(item => item.erro);
  } else if (status === 'custo_zerado') {
    produtos = produtos.filter(item => item.custo_zerado);
  } else if (status === 'lucro_negativo') {
    produtos = produtos.filter(item => item.lucro_negativo);
  } else if (status === 'ok') {
    produtos = produtos.filter(item => !item.erro);
  }

  const totais = produtos.reduce((acc, item) => {
    acc.total_produtos += 1;
    acc.total_erros += item.erro ? 1 : 0;
    acc.total_custo_zerado += item.custo_zerado ? 1 : 0;
    acc.total_lucro_negativo += item.lucro_negativo ? 1 : 0;
    return acc;
  }, {
    total_produtos: 0,
    total_erros: 0,
    total_custo_zerado: 0,
    total_lucro_negativo: 0
  });

  return { produtos, totais };
}

module.exports = {
  listar
};
