const pool = require('../../../db/connection');

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
// BUSCAR CIDADES POR NOME
// ==========================================
async function buscarCidadesPorNome(nome) {
    const result = await pool.query(
          `
              SELECT id, codigo_ibge, nome, estado
                  FROM cidades
                      WHERE LOWER(unaccent(nome)) LIKE LOWER(unaccent($1))
                          ORDER BY nome
                              LIMIT 20;
                                  `,
          [`%${nome}%`]
        );

  return result.rows;
}

// ==========================================
// BUSCAR CIDADE POR ID
// (USADO NO FRONTEND DE FORNECEDOR)
// ==========================================
async function buscarCidadePorId(id) {
    const result = await pool.query(
          `
              SELECT id, nome, estado
                  FROM cidades
                      WHERE id = $1
                          `,
          [id]
        );

  return result.rows[0] || null;
}

// ==========================================
// CRIAR CIDADE
// ==========================================
async function criarCidade(nome, estado) {
    const result = await pool.query(
          `
              INSERT INTO cidades (nome, estado)
                  VALUES ($1, $2)
                      RETURNING *;
                          `,
          [nome, estado]
        );

  return result.rows[0];
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
// VINCULAR CIDADE
// ==========================================
async function vincularCidade(transportadora_id, codigo_ibge, observacao) {
    const cidadeResult = await pool.query(
          'SELECT id FROM cidades WHERE codigo_ibge = $1',
          [codigo_ibge]
        );

  if (cidadeResult.rows.length === 0) {
        throw new Error('Cidade nao encontrada');
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
// BUSCA INTELIGENTE PARA BOT
// ==========================================
async function buscarTransportadorasPorNomeCidade(nomeCidade) {
    const partes = nomeCidade.split('-').map(p => p.trim());
    const cidade = partes[0];
    const estado = partes[1] || null;

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
              return { tipo: "resultado", dados: resultadoFrete.rows };
      }

      return {
              tipo: "sem_frete",
              cidade: cidadeExiste.rows[0].nome,
              estado: cidadeExiste.rows[0].estado
      };
  }

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
        return { tipo: "sugestao", cidades: resultadoParcial.rows };
  }

  return { tipo: "vazio" };
}

// ==========================================
// LISTAR CIDADES COM TRANSPORTADORA POR ESTADO (UF)
// ==========================================
async function listarCidadesPorEstado(uf) {
      const result = await pool.query(
              `SELECT
                     c.id,
                            c.codigo_ibge,
                                   c.nome,
                                          c.estado,
                                                 json_agg(
                                                          json_build_object(
                                                                     'nome', t.nome,
                                                                                'telefone', t.telefone,
                                                                                           'observacao', tc.observacao
                                                                                                    ) ORDER BY t.nome
                                                                                                           ) AS transportadoras
                                                                                                                FROM cidades c
                                                                                                                     JOIN transportadora_cidade tc ON tc.cidade_id = c.id
                                                                                                                          JOIN transportadoras t ON t.id = tc.transportadora_id
                                                                                                                               WHERE LOWER(c.estado) = LOWER($1)
                                                                                                                                    GROUP BY c.id, c.codigo_ibge, c.nome, c.estado
                                                                                                                                         ORDER BY c.nome;`,
              [uf]
            );
      return result.rows;
}
// LISTAR SOMENTE NOMES DE CIDADES POR ESTADO
// (uso bot / n8n)
// ==========================================
async function listarSomenteCidadesPorEstado(uf) {
    const result = await pool.query(
          `SELECT nome
               FROM cidades
                    WHERE LOWER(estado) = LOWER($1)
                         ORDER BY nome;`,
          [uf]
        );
    return result.rows.map(r => r.nome);
}

// ==========================================
// EXPORTS
// ==========================================
module.exports = {
    listarEstados,
    buscarCidadesPorNome,
    buscarCidadePorId,
    criarCidade,
    listarCidades,
    vincularCidade,
    removerCidade,
    buscarTransportadorasPorNomeCidade,
    listarCidadesPorEstado,
    listarSomenteCidadesPorEstado
};
