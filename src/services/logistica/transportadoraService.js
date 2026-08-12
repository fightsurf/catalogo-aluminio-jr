const pool = require('../../../db/connection');

let estruturaPromise = null;

// ==========================================
// GARANTIR NOVOS CAMPOS (compatível com base já existente)
// ==========================================
async function garantirEstruturaTransportadoras() {
  if (!estruturaPromise) {
    estruturaPromise = (async () => {
      await pool.query(`
        ALTER TABLE transportadoras
        ADD COLUMN IF NOT EXISTS cidade_id BIGINT REFERENCES cidades(id) ON DELETE SET NULL;
      `);

      await pool.query(`
        ALTER TABLE transportadoras
        ADD COLUMN IF NOT EXISTS telefone_principal TEXT;
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_transportadoras_cidade_id
        ON transportadoras(cidade_id);
      `);
    })().catch((error) => {
      estruturaPromise = null;
      throw error;
    });
  }

  return estruturaPromise;
}

// ==========================================
// LISTAR TRANSPORTADORAS
// ==========================================
async function listarTransportadoras() {
  await garantirEstruturaTransportadoras();

  const result = await pool.query(`
    SELECT
      t.id,
      t.nome,
      t.telefone,
      t.telefone_principal,
      t.observacao,
      t.cidade_id,
      c.nome AS cidade_nome,
      c.estado AS cidade_estado
    FROM transportadoras t
    LEFT JOIN cidades c ON c.id = t.cidade_id
    ORDER BY LOWER(unaccent(t.nome));
  `);

  return result.rows;
}

// ==========================================
// CRIAR TRANSPORTADORA
// ==========================================
async function criarTransportadora(dados) {
  await garantirEstruturaTransportadoras();

  const { nome, telefone, telefone_principal, observacao, cidade_id } = dados;

  const result = await pool.query(
    `
    INSERT INTO transportadoras
    (nome, telefone, telefone_principal, observacao, cidade_id)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING id;
    `,
    [
      nome,
      telefone || null,
      telefone_principal || null,
      observacao || null,
      cidade_id || null
    ]
  );

  const criado = await pool.query(`
    SELECT
      t.id,
      t.nome,
      t.telefone,
      t.telefone_principal,
      t.observacao,
      t.cidade_id,
      c.nome AS cidade_nome,
      c.estado AS cidade_estado
    FROM transportadoras t
    LEFT JOIN cidades c ON c.id = t.cidade_id
    WHERE t.id = $1;
  `, [result.rows[0].id]);

  return criado.rows[0];
}

// ==========================================
// ATUALIZAR TRANSPORTADORA
// ==========================================
async function atualizarTransportadora(id, dados) {
  await garantirEstruturaTransportadoras();

  const { nome, telefone, telefone_principal, observacao, cidade_id } = dados;

  const result = await pool.query(
    `
    UPDATE transportadoras
    SET nome = $1,
        telefone = $2,
        telefone_principal = $3,
        observacao = $4,
        cidade_id = $5
    WHERE id = $6
    RETURNING id;
    `,
    [
      nome || null,
      telefone || null,
      telefone_principal || null,
      observacao || null,
      cidade_id || null,
      id
    ]
  );

  if (!result.rows[0]) return null;

  const atualizado = await pool.query(`
    SELECT
      t.id,
      t.nome,
      t.telefone,
      t.telefone_principal,
      t.observacao,
      t.cidade_id,
      c.nome AS cidade_nome,
      c.estado AS cidade_estado
    FROM transportadoras t
    LEFT JOIN cidades c ON c.id = t.cidade_id
    WHERE t.id = $1;
  `, [result.rows[0].id]);

  return atualizado.rows[0];
}


// ==========================================
// ATUALIZAR APENAS O TELEFONE PRINCIPAL
// ==========================================
async function atualizarTelefonePrincipal(id, telefonePrincipal) {
  await garantirEstruturaTransportadoras();

  const telefone = String(telefonePrincipal || '').trim();

  if (!telefone) {
    const error = new Error('Telefone Principal é obrigatório.');
    error.statusCode = 400;
    throw error;
  }

  const result = await pool.query(
    `
    UPDATE transportadoras
    SET telefone_principal = $1
    WHERE id = $2
    RETURNING id, nome, telefone, telefone_principal, observacao, cidade_id;
    `,
    [telefone, id]
  );

  return result.rows[0] || null;
}

// ==========================================
// DELETAR TRANSPORTADORA
// ==========================================
async function deletarTransportadora(id) {
  await garantirEstruturaTransportadoras();

  await pool.query(
    `DELETE FROM transportadoras WHERE id = $1`,
    [id]
  );
}

module.exports = {
  listarTransportadoras,
  criarTransportadora,
  atualizarTransportadora,
  atualizarTelefonePrincipal,
  deletarTransportadora
};
