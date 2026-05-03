const pool = require('../../../db/connection');

function normalizarId(value, campo) {
  const numero = Number.parseInt(value, 10);
  if (!Number.isInteger(numero) || numero <= 0) {
    throw new Error(`${campo} inválido`);
  }
  return numero;
}

function mapearFornecedor(row) {
  return {
    id: row.id,
    nome: row.nome,
    total_insumos: Number(row.total_insumos || 0)
  };
}

function mapearItem(row) {
  return {
    insumo_fornecedor_id: row.insumo_fornecedor_id,
    insumo_id: row.insumo_id,
    insumo: row.insumo,
    categoria: row.categoria,
    fornecedor_id: row.fornecedor_id,
    fornecedor: row.fornecedor,
    unidade_custo: row.unidade_custo,
    preco_base: Number(row.preco_base || 0),
    eh_disco: row.eh_disco,
    diametro_mm: row.diametro_mm !== null ? Number(row.diametro_mm) : null,
    espessura_mm: row.espessura_mm !== null ? Number(row.espessura_mm) : null,
    peso_kg: row.peso_kg !== null ? Number(row.peso_kg) : null
  };
}

async function listarFornecedoresComInsumos() {
  const result = await pool.query(`
    SELECT
      f.id,
      f.nome,
      COUNT(ifn.id)::int AS total_insumos
    FROM fornecedores f
    JOIN insumos_fornecedores ifn ON ifn.fornecedor_id = f.id
    JOIN insumos i ON i.id = ifn.insumo_id
    WHERE ifn.ativo = TRUE
      AND i.ativo = TRUE
    GROUP BY f.id, f.nome
    ORDER BY f.nome ASC
  `);

  return result.rows.map(mapearFornecedor);
}

async function listarItensPorFornecedor(fornecedorIdParam) {
  const fornecedorId = normalizarId(fornecedorIdParam, 'Fornecedor');

  const fornecedorResult = await pool.query(
    'SELECT id, nome FROM fornecedores WHERE id = $1',
    [fornecedorId]
  );

  if (fornecedorResult.rows.length === 0) {
    throw new Error('Fornecedor não encontrado');
  }

  const itensResult = await pool.query(`
    SELECT
      ifn.id AS insumo_fornecedor_id,
      ifn.insumo_id,
      i.nome AS insumo,
      c.nome AS categoria,
      ifn.fornecedor_id,
      f.nome AS fornecedor,
      ifn.unidade_custo,
      ifn.preco_base,
      (d.insumo_id IS NOT NULL) AS eh_disco,
      d.diametro_mm,
      d.espessura_mm,
      d.peso_kg
    FROM insumos_fornecedores ifn
    JOIN insumos i ON i.id = ifn.insumo_id
    JOIN insumos_categorias c ON c.id = i.categoria_insumo_id
    JOIN fornecedores f ON f.id = ifn.fornecedor_id
    LEFT JOIN insumos_discos d ON d.insumo_id = i.id
    WHERE ifn.fornecedor_id = $1
      AND ifn.ativo = TRUE
      AND i.ativo = TRUE
    ORDER BY c.nome ASC, i.nome ASC
  `, [fornecedorId]);

  return {
    fornecedor: fornecedorResult.rows[0],
    itens: itensResult.rows.map(mapearItem)
  };
}

module.exports = {
  listarFornecedoresComInsumos,
  listarItensPorFornecedor
};
