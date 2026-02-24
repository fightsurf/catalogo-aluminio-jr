const pool = require('../../db/connection');

async function listar(nome, ativo) {
  let query = 'SELECT * FROM funcionarios WHERE 1=1';
  const params = [];
  let index = 1;

  if (nome) {
    query += ` AND LOWER(nome) LIKE LOWER($${index})`;
    params.push(`%${nome}%`);
    index++;
  }

  if (ativo !== undefined) {
    query += ` AND ativo = $${index}`;
    params.push(ativo === 'true');
    index++;
  }

  query += ' ORDER BY nome';

  const result = await pool.query(query, params);
  return result.rows;
}

async function buscarPorId(id) {
  const result = await pool.query(
    'SELECT * FROM funcionarios WHERE id = $1',
    [id]
  );
  return result.rows[0];
}

async function criar(nome, telefone, data_nascimento) {
  const result = await pool.query(
    `
    INSERT INTO funcionarios (nome, telefone, data_nascimento)
    VALUES ($1, $2, $3)
    RETURNING *
    `,
    [nome, telefone, data_nascimento]
  );
  return result.rows[0];
}

async function atualizar(id, nome, telefone, data_nascimento) {
  const result = await pool.query(
    `
    UPDATE funcionarios
    SET nome = $1,
        telefone = $2,
        data_nascimento = $3,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = $4
    RETURNING *
    `,
    [nome, telefone, data_nascimento, id]
  );

  return result.rows[0];
}

async function remover(id) {
  await pool.query(
    `
    UPDATE funcionarios
    SET ativo = false,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = $1
    `,
    [id]
  );
}

module.exports = {
  listar,
  buscarPorId,
  criar,
  atualizar,
  remover
};
