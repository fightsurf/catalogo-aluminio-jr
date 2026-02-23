const pool = require('../../db/connection');

async function listarTransportadoras() {
  const result = await pool.query(
    'SELECT * FROM transportadoras ORDER BY id'
  );
  return result.rows;
}

async function criarTransportadora(dados) {
  const { nome, contato_principal, telefone, observacoes } = dados;

  const result = await pool.query(
    `
    INSERT INTO transportadoras
    (nome, contato_principal, telefone, observacoes)
    VALUES ($1, $2, $3, $4)
    RETURNING *;
    `,
    [nome, contato_principal || null, telefone || null, observacoes || null]
  );

  return result.rows[0];
}

async function atualizarTransportadora(id, dados) {
  const { nome, telefone } = dados;

  const result = await pool.query(
    `
    UPDATE transportadoras
    SET nome = $1,
        telefone = $2
    WHERE id = $3
    RETURNING *;
    `,
    [nome, telefone, id]
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
