const pool = require('../../db/connection');

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

  return result;
}

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

async function listarCidades(transportadora_id) {
  const result = await pool.query(
    `
    SELECT c.codigo_ibge, c.nome, c.estado, tc.observacao
    FROM transportadora_cidade tc
    JOIN cidades c ON tc.cidade_id = c.id
    WHERE tc.transportadora_id = $1
    ORDER BY c.nome;
    `,
    [transportadora_id]
  );

  return result.rows;
}

async function listarTransportadorasPorCidade(codigo_ibge) {
  const result = await pool.query(
    `
    SELECT t.id, t.nome, t.telefone, tc.observacao
    FROM transportadora_cidade tc
    JOIN cidades c ON tc.cidade_id = c.id
    JOIN transportadoras t ON tc.transportadora_id = t.id
    WHERE c.codigo_ibge = $1;
    `,
    [codigo_ibge]
  );

  return result.rows;
}

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

module.exports = {
  vincularCidade,
  removerCidade,
  listarCidades,
  listarTransportadorasPorCidade,
  buscarCidadesPorNome
};
