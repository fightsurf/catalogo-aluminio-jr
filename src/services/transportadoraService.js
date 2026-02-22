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

module.exports = {
  listarTransportadoras,
  criarTransportadora
};
