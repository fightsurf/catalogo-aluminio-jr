const pool = require('../../../db/connection');

async function listar() {
  const result = await pool.query(
    'SELECT * FROM produtos_categorias ORDER BY nome'
  );
  return result.rows;
}

async function buscar(id) {
  const result = await pool.query(
    'SELECT * FROM produtos_categorias WHERE id = $1',
    [id]
  );

  if (result.rows.length === 0) {
    throw new Error('Categoria não encontrada');
  }

  return result.rows[0];
}

async function criar(data) {

  const { nome } = data;

  if (!nome) {
    throw new Error('Nome é obrigatório');
  }

  const query = `
    INSERT INTO produtos_categorias (nome)
    VALUES ($1)
    RETURNING *;
  `;

  const values = [nome];

  const result = await pool.query(query, values);

  return result.rows[0];
}

async function atualizar(id, data) {
  const { nome } = data;

  const result = await pool.query(
    `UPDATE produtos_categorias
     SET nome = $1
     WHERE id = $2
     RETURNING *`,
    [nome, id]
  );

  if (result.rows.length === 0) {
    throw new Error('Categoria não encontrada');
  }

  return result.rows[0];
}

async function excluir(id) {

  // 🔒 Verificar se existem produtos vinculados
  const vinculos = await pool.query(
    'SELECT COUNT(*) FROM produtos WHERE categoria_id = $1',
    [id]
  );

  if (Number(vinculos.rows[0].count) > 0) {
    throw new Error('Não é possível excluir. Existem produtos vinculados.');
  }

  await pool.query(
    'DELETE FROM produtos_categorias WHERE id = $1',
    [id]
  );
}

module.exports = {
  listar,
  buscar,
  criar,
  atualizar,
  excluir
};
