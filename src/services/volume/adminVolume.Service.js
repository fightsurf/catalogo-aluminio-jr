const pool = require('../../../db/connection');

async function listar({ search, categoria } = {}) {
  let query = `
    SELECT p.id, p.nome, p.capacidade_caixa AS volume,
           c.id AS categoria_id, c.nome AS categoria
    FROM produtos p
    LEFT JOIN produtos_categorias c ON p.categoria_id = c.id
    WHERE 1=1
  `;
  const values = [];

  if (search) {
    values.push(`%${search}%`);
    query += ` AND (p.nome ILIKE $${values.length} OR p.id::text ILIKE $${values.length})`;
  }

  if (categoria) {
    values.push(categoria);
    query += ` AND p.categoria_id = $${values.length}`;
  }

  query += ` ORDER BY p.nome ASC`;

  const result = await pool.query(query, values);
  return result.rows;
}

async function atualizarVolume(id, volume) {
  if (volume === undefined || volume === null || volume === '') {
    throw new Error('O campo volume é obrigatório');
  }

  const num = Number(volume);

  if (isNaN(num)) {
    throw new Error('O campo volume deve ser numérico');
  }

  if (num < 0) {
    throw new Error('O campo volume deve ser maior ou igual a 0');
  }

  const result = await pool.query(
    `UPDATE produtos SET capacidade_caixa = $1, updated_at = NOW() WHERE id = $2 RETURNING id, nome, capacidade_caixa AS volume`,
    [num, id]
  );

  if (result.rows.length === 0) {
    const err = new Error('Produto não encontrado');
    err.status = 404;
    throw err;
  }

  return result.rows[0];
}

module.exports = { listar, atualizarVolume };
