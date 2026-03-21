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
// LISTAR ESTADOS
// ==========================================
async function listarEstados() {
  const result = await pool.query(`
    SELECT DISTINCT estado
    FROM cidades
    ORDER BY estado;
  `);

  return result.rows;
}

// ==========================================
// NOVO: LISTAR CIDADES + TRANSPORTADORAS POR UF
// Retorno no formato que a view já espera
// ==========================================
async function listarCidadesPorEstado(uf) {
  const ufNormalizada = String(uf).trim().toUpperCase();

  const result = await pool.query(
    `
    SELECT
      c.id AS cidade_id,
      c.nome AS cidade,
      c.estado,
      t.nome AS transportadora_nome,
      t.telefone AS transportadora_telefone
    FROM cidades c
    JOIN transportadora_cidade tc
      ON tc.cidade_id = c.id
    JOIN transportadoras t
      ON t.id = tc.transportadora_id
    WHERE UPPER(c.estado) = UPPER($1)
    ORDER BY c.nome, t.nome;
    `,
    [ufNormalizada]
  );

  const mapa = new Map();

  for (const row of result.rows) {
    if (!mapa.has(row.cidade_id)) {
      mapa.set(row.cidade_id, {
        cidade: row.cidade,
        estado: row.estado,
        transportadoras: []
      });
    }

    mapa.get(row.cidade_id).transportadoras.push({
      nome: row.transportadora_nome,
      telefone: row.transportadora_telefone
    });
  }

  return Array.from(mapa.values());
}


// ==========================================
// NOVO: LISTAR APENAS CIDADES COM FRETE POR UF
// Uso específico para bot / n8n
// ==========================================
async function listarSomenteCidadesPorEstado(uf) {
  const ufNormalizada = String(uf).trim().toUpperCase();

  const result = await pool.query(
    `
    SELECT DISTINCT
      c.nome AS cidade,
      c.estado
    FROM cidades c
    JOIN transportadora_cidade tc
      ON tc.cidade_id = c.id
    WHERE UPPER(c.estado) = UPPER($1)
    ORDER BY c.nome;
    `,
    [ufNormalizada]
  );

  if (result.rows.length === 0) {
    return {
      tipo: 'vazio',
      uf: ufNormalizada
    };
  }

  return {
    tipo: 'resultado',
    uf: ufNormalizada,
    dados: result.rows
  };
}


// ==========================================
// 🔥 BUSCA DE FRETE (BOT)
// ==========================================
async function buscarTransportadorasPorNomeCidade(nomeCidade) {
  const partes = nomeCidade.split('-').map(p => p.trim());
  const cidade = partes[0];
  const estado = partes[1] || null;

  let queryCidade = `
    SELECT nome, estado
    FROM cidades
    WHERE LOWER(nome) = LOWER($1)
  `;

  let params = [cidade];

  if (estado) {
    queryCidade += ` AND LOWER(estado) = LOWER($2)`;
    params.push(estado);
  }

  const cidadeExiste = await pool.query(queryCidade, params);

  if (cidadeExiste.rows.length === 0) {
    return { tipo: "vazio" };
  }

  let queryFrete = `
    SELECT 
      t.id,
      t.nome,
      t.telefone,
      tc.observacao,
      c.nome AS cidade_nome,
      c.estado
    FROM transportadora_cidade tc
    JOIN cidades c ON tc.cidade_id = c.id
    JOIN transportadoras t ON tc.transportadora_id = t.id
    WHERE LOWER(c.nome) = LOWER($1)
  `;

  if (estado) {
    queryFrete += ` AND LOWER(c.estado) = LOWER($2)`;
  }

  queryFrete += ` ORDER BY t.nome`;

  const resultadoFrete = await pool.query(queryFrete, params);

  if (resultadoFrete.rows.length > 0) {
    return {
      tipo: "resultado",
      dados: resultadoFrete.rows
    };
  }

  return {
    tipo: "sem_frete",
    cidade: cidadeExiste.rows[0].nome,
    estado: cidadeExiste.rows[0].estado
  };
}

module.exports = {
  vincularCidade,
  removerCidade,
  listarCidades,
  buscarCidadesPorNome,
  criarCidade,
  listarEstados,
  listarCidadesPorEstado,
  listarSomenteCidadesPorEstado,
  buscarTransportadorasPorNomeCidade
};
