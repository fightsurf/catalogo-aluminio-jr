const pool = require('../../../db/connection');

// ==========================================
// VINCULAR CIDADE
// ==========================================
async function vincularCidade(transportadora_id, codigo_ibge, observacao) {
  const cidadeResult = await pool.query(
    'SELECT id FROM cidades WHERE codigo_ibge = $1',
    [codigo_ibge]
  );

  if (cidadeResult.rows.length === 0) {
    throw new Error('Cidade não encontrada');
  }

  const cidade_id = cidadeResult.rows[0].id;

  const result = await pool.query(
    `
    INSERT INTO transportadora_cidade (transportadora_id, cidade_id, observacao)
    VALUES ($1, $2, $3)
    ON CONFLICT (transportadora_id, cidade_id)
    DO UPDATE SET observacao = EXCLUDED.observacao
    RETURNING *;
    `,
    [transportadora_id, cidade_id, observacao || null]
  );

  return result.rows[0];
}

// ==========================================
// REMOVER CIDADE
// ==========================================
async function removerCidade(transportadora_id, codigo_ibge) {
  await pool.query(
    `
    DELETE FROM transportadora_cidade
    USING cidades
    WHERE transportadora_cidade.cidade_id = cidades.id
    AND transportadora_id = $1
    AND cidades.codigo_ibge = $2;
    `,
    [transportadora_id, codigo_ibge]
  );
}

// ==========================================
// LISTAR CIDADES POR TRANSPORTADORA
// ==========================================
async function listarCidades(transportadora_id) {
  const result = await pool.query(
    `
    SELECT 
      c.codigo_ibge,
      c.nome,
      c.estado,
      tc.observacao
    FROM transportadora_cidade tc
    JOIN cidades c ON tc.cidade_id = c.id
    WHERE tc.transportadora_id = $1
    ORDER BY c.nome;
    `,
    [transportadora_id]
  );

  return result.rows;
}

// ==========================================
// BUSCAR CIDADES POR NOME
// ==========================================
async function buscarCidadesPorNome(nome) {
  const result = await pool.query(
    `
    SELECT codigo_ibge, nome, estado
    FROM cidades
    WHERE LOWER(nome) LIKE LOWER($1)
    ORDER BY nome
    LIMIT 20;
    `,
    [`%${nome}%`]
  );

  return result.rows;
}

// ==========================================
// CRIAR CIDADE
// ==========================================
async function criarCidade(nome, estado) {

  const existente = await pool.query(
    `
    SELECT id
    FROM cidades
    WHERE LOWER(nome) = LOWER($1)
      AND LOWER(estado) = LOWER($2);
    `,
    [nome, estado]
  );

  if (existente.rows.length > 0) {
    throw new Error('Cidade já cadastrada para este estado');
  }

  const result = await pool.query(
    `
    INSERT INTO cidades (nome, estado, codigo_ibge)
    VALUES ($1, $2, nextval('cidades_id_seq'))
    RETURNING id, nome, estado, codigo_ibge;
    `,
    [nome.trim(), estado.trim()]
  );

  return result.rows[0];
}

// ==========================================
// LISTAR ESTADOS (CORRIGIDO)
// ==========================================
async function listarEstados() {
  const result = await pool.query(`
    SELECT DISTINCT estado
    FROM cidades
    ORDER BY estado;
  `);

  return result.rows;
}

module.exports = {
  vincularCidade,
  removerCidade,
  listarCidades,
  buscarCidadesPorNome,
  criarCidade,
  listarEstados
};
