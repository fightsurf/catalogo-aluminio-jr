'use strict';

// Consultas detalhadas exclusivas do MCP autenticado (/mcp/clientes).
// Os registros de excursões e transportadoras compartilham a tabela transportadoras.
const pool = require('../../../db/connection');
const clientesService = require('../legado/clientes/clientes.service');

function inteiro(valor, padrao, maximo, campo) {
  const n = valor === undefined ? padrao : valor;
  if (!Number.isSafeInteger(n) || n < 1 || n > maximo) {
    throw new Error(campo + ' inválido.');
  }
  return n;
}

function resumirCliente(cliente) {
  if (!cliente) return null;
  return {
    favorecido: cliente.favorecido ?? null,
    nome: String(cliente.nome || cliente.razao_social || cliente.razao || '').trim(),
    cidade: cliente.cidade || null,
    uf: cliente.uf || null,
    telefone: cliente.telefonePrincipal || cliente.telefone_principal || cliente.telefone || cliente.fone1 || null,
    // A API legada pode não fornecer observações; não inventar seu conteúdo.
    observacao: cliente.observacao ?? cliente.observacoes ?? null
  };
}

async function consultarCliente({ favorecido } = {}) {
  const id = inteiro(favorecido, undefined, 2147483647, 'Código de cliente');
  const cliente = await clientesService.buscarCliente(id);
  return { encontrado: Boolean(cliente), cliente: resumirCliente(cliente) };
}

async function listarExcursoesTransportadoras({ nome = '', pagina = 1, limite = 20 } = {}) {
  if (typeof nome !== 'string' || nome.length > 120) {
    throw new Error('O filtro nome deve ter até 120 caracteres.');
  }
  const page = inteiro(pagina, 1, 100000, 'Página');
  const size = inteiro(limite, 20, 50, 'Limite');
  const offset = (page - 1) * size;
  const filtro = nome.trim();
  const criterio = "($1 = '' OR t.nome ILIKE '%' || $1 || '%')";
  const contagem = await pool.query(
    'SELECT COUNT(*)::integer AS total FROM transportadoras t WHERE ' + criterio,
    [filtro]
  );
  const resultado = await pool.query(`
    SELECT t.id, t.nome, t.telefone_principal, t.telefone, t.observacao,
           origem.nome AS cidade, origem.estado AS uf,
           COALESCE((
             SELECT json_agg(
               json_build_object('cidade', c.nome, 'uf', c.estado, 'codigo_ibge', c.codigo_ibge,
                                 'observacao', tc.observacao)
               ORDER BY c.nome, c.estado
             )
             FROM transportadora_cidade tc
             JOIN cidades c ON c.id = tc.cidade_id
             WHERE tc.transportadora_id = t.id
           ), '[]'::json) AS cidades_vinculadas
    FROM transportadoras t
    LEFT JOIN cidades origem ON origem.id = t.cidade_id
    WHERE ${criterio}
    ORDER BY t.nome, t.id
    LIMIT $2 OFFSET $3
  `, [filtro, size, offset]);
  const total = Number(contagem.rows[0]?.total || 0);
  return {
    total_encontrado: total,
    pagina: page,
    limite: size,
    exibindo: resultado.rows.length,
    tem_proxima_pagina: offset + resultado.rows.length < total,
    cadastros: resultado.rows.map(t => ({
      id: t.id, nome: t.nome,
      cidade: t.cidade || null, uf: t.uf || null,
      telefone: t.telefone_principal || t.telefone || null,
      observacao: t.observacao || null,
      cidades_vinculadas: t.cidades_vinculadas || []
    }))
  };
}

module.exports = { resumirCliente, consultarCliente, listarExcursoesTransportadoras };
