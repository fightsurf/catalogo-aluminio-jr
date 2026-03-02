const pool = require('../../../db/connection');

async function listar(search) {
  let query = `
    SELECT id, nome, capacidade_caixa AS volume
    FROM produtos
    WHERE 1=1
  `;
  const values = [];

  if (search) {
    values.push(`%${search}%`);
    query += ` AND (nome ILIKE $${values.length} OR id::text ILIKE $${values.length})`;
  }

  query += ` ORDER BY nome ASC`;

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
