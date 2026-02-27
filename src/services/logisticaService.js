const pool = require('../../db/connection');

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
// BUSCA INTELIGENTE PARA O BOT
// ==========================================
async function buscarTransportadorasPorNomeCidade(nomeCidade) {

  const partes = nomeCidade.split('-').map(p => p.trim());
  const cidade = partes[0];
  const estado = partes[1] || null;

  // 1️⃣ VERIFICA SE A CIDADE EXISTE
  let cidadeQuery = `
    SELECT nome, estado
    FROM cidades
    WHERE LOWER(unaccent(nome)) = LOWER(unaccent($1))
  `;

  let cidadeParams = [cidade];

  if (estado) {
    cidadeQuery += ` AND LOWER(unaccent(estado)) = LOWER(unaccent($2))`;
    cidadeParams.push(estado);
  }

  const cidadeExiste = await pool.query(cidadeQuery, cidadeParams);

  // 2️⃣ SE EXISTE → BUSCAR TRANSPORTADORAS
  if (cidadeExiste.rows.length > 0) {

    const resultadoFrete = await pool.query(
      `
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
      WHERE LOWER(unaccent(c.nome)) = LOWER(unaccent($1))
      ${estado ? "AND LOWER(unaccent(c.estado)) = LOWER(unaccent($2))" : ""}
      ORDER BY t.nome;
      `,
      cidadeParams
    );

    if (resultadoFrete.rows.length > 0) {
      return {
        tipo: "resultado",
        dados: resultadoFrete.rows
      };
    }

    // Cidade existe mas não tem transportadora
    return {
      tipo: "sem_frete",
      cidade: cidadeExiste.rows[0].nome,
      estado: cidadeExiste.rows[0].estado
    };
  }

  // 3️⃣ NÃO EXISTE → BUSCA PARCIAL
  const resultadoParcial = await pool.query(
    `
    SELECT nome, estado
    FROM cidades
    WHERE LOWER(unaccent(nome)) LIKE LOWER(unaccent($1))
    ORDER BY nome;
    `,
    [`%${cidade}%`]
  );

  if (resultadoParcial.rows.length > 0) {
    return {
      tipo: "sugestao",
      cidades: resultadoParcial.rows
    };
  }

  return { tipo: "vazio" };
}

// ==========================================
// LISTAR CIDADES POR ESTADO
// ==========================================
async function listarCidadesPorEstado(nomeEstado) {
  const result = await pool.query(
    `
    SELECT 
      c.codigo_ibge,
      c.nome AS cidade,
      c.estado,
      t.id AS transportadora_id,
      t.nome AS transportadora_nome,
      t.telefone
    FROM cidades c
    JOIN transportadora_cidade tc ON tc.cidade_id = c.id
    JOIN transportadoras t ON tc.transportadora_id = t.id
    WHERE LOWER(c.estado) LIKE LOWER($1)
    ORDER BY c.nome, t.nome;
    `,
    [`%${nomeEstado}%`]
  );

  const cidadesMap = {};

  result.rows.forEach(row => {
    if (!cidadesMap[row.codigo_ibge]) {
      cidadesMap[row.codigo_ibge] = {
        codigo_ibge: row.codigo_ibge,
        cidade: row.cidade,
        estado: row.estado,
        transportadoras: []
      };
    }

    cidadesMap[row.codigo_ibge].transportadoras.push({
      id: row.transportadora_id,
      nome: row.transportadora_nome,
      telefone: row.telefone
    });
  });

  return Object.values(cidadesMap);
}

module.exports = {
  vincularCidade,
  removerCidade,
  listarCidades,
  buscarCidadesPorNome,
  buscarTransportadorasPorNomeCidade,
  listarCidadesPorEstado
};
