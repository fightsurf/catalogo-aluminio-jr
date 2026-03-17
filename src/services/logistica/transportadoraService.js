const pool = require('../../../db/connection');

// ==========================================
// LISTAR TRANSPORTADORAS
// ==========================================
async function listarTransportadoras() {
  const result = await pool.query(`
    SELECT id, nome, telefone, observacao
    FROM transportadoras
    ORDER BY LOWER(unaccent(nome));
  `);

  return result.rows;
}

// ==========================================
// CRIAR TRANSPORTADORA
// ==========================================
async function criarTransportadora(dados) {
  const { nome, telefone, observacao } = dados;

  const result = await pool.query(
    `
    INSERT INTO transportadoras
    (nome, telefone, observacao)
    VALUES ($1, $2, $3)
    RETURNING id, nome, telefone, observacao;
    `,
    [nome, telefone || null, observacao || null]
  );

  return result.rows[0];
}

// ==========================================
// ATUALIZAR TRANSPORTADORA
// ==========================================
async function atualizarTransportadora(id, dados) {
  const { nome, telefone, observacao } = dados;

  const result = await pool.query(
    `
    UPDATE transportadoras
    SET nome = $1,
        telefone = $2,
        observacao = $3
    WHERE id = $4
    RETURNING id, nome, telefone, observacao;
    `,
    [
      nome || null,
      telefone || null,
      observacao || null,
      id
    ]
  );

  return result.rows[0];
}

// ==========================================
// DELETAR TRANSPORTADORA
// ==========================================
async function deletarTransportadora(id) {
  await pool.query(
    `DELETE FROM transportadoras WHERE id = $1`,
    [id]
  );
}

module.exports = {
  listarTransportadoras,
  criarTransportadora,
  atualizarTransportadora,
  deletarTransportadora
};
