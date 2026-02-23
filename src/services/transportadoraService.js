const pool = require('../../db/connection');

async function listarTransportadoras() {
  const result = await pool.query(
    'SELECT * FROM transportadoras ORDER BY id'
  );
  return result.rows;
}

async function criarTransportadora(dados) {
  const { nome, telefone, observacao } = dados;

  const result = await pool.query(
    `
    INSERT INTO transportadoras
    (nome, telefone, observacao)
    VALUES ($1, $2, $3)
    RETURNING *;
    `,
    [nome, telefone || null, observacao || null]
  );

  return result.rows[0];
}

async function atualizarTransportadora(id, dados) {
  const { nome, telefone, observacao } = dados;

  const result = await pool.query(
    `
    UPDATE transportadoras
    SET nome = $1,
        telefone = $2,
        observacao = $3
    WHERE id = $4
    RETURNING *;
    `,
    [nome, telefone, observacao, id]
  );

  return result.rows[0];
}

async function deletarTransportadora(id) {
  await pool.query(
    'DELETE FROM transportadoras WHERE id = $1',
    [id]
  );
}

module.exports = {
  listarTransportadoras,
  criarTransportadora,
  atualizarTransportadora,
  deletarTransportadora
};
