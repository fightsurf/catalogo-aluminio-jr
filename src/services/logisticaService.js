const pool = require('../../db/connection');

// ================================
// CIDADES POR ESTADO COM TRANSPORTADORAS
// ================================
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

  // Agrupar por cidade
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
  listarCidadesPorEstado
};
