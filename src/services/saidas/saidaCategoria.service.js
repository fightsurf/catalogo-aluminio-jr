const pool = require('../../../db/connection');

function normalizarTexto(value) {
  return String(value || '').trim();
}

function normalizarId(value, campo = 'ID') {
  const numero = Number.parseInt(value, 10);
  if (!Number.isInteger(numero) || numero <= 0) {
    throw new Error(`${campo} inválido`);
  }
  return numero;
}

function parseAtivo(value) {
  if (value === undefined || value === null || value === '') return null;
  if (value === true || value === 'true' || value === '1' || value === 1) return true;
  if (value === false || value === 'false' || value === '0' || value === 0) return false;
  throw new Error('Valor de ativo inválido');
}

async function nomeJaExiste(nome, idIgnorar = null) {
  const values = [normalizarTexto(nome)];
  let query = `
    SELECT 1
    FROM despesa_categorias
    WHERE LOWER(TRIM(nome)) = LOWER(TRIM($1))
  `;

  if (idIgnorar) {
    values.push(normalizarId(idIgnorar));
    query += ` AND id <> $${values.length}`;
  }

  query += ' LIMIT 1';
  const result = await pool.query(query, values);
  return result.rows.length > 0;
}

async function listar(filtros = {}) {
  const conditions = [];
  const values = [];

  if (filtros.nome) {
    values.push(`%${normalizarTexto(filtros.nome)}%`);
    conditions.push(`nome ILIKE $${values.length}`);
  }

  const ativo = parseAtivo(filtros.ativo);
  if (ativo !== null) {
    values.push(ativo);
    conditions.push(`ativo = $${values.length}`);
  }

  let query = `
    SELECT id, nome, ativo, observacao, created_at, updated_at
    FROM despesa_categorias
  `;

  if (conditions.length) {
    query += ` WHERE ${conditions.join(' AND ')}`;
  }

  query += ' ORDER BY nome ASC';

  const result = await pool.query(query, values);
  return result.rows;
}

async function buscar(id) {
  const result = await pool.query(
    `SELECT id, nome, ativo, observacao, created_at, updated_at
     FROM despesa_categorias
     WHERE id = $1`,
    [normalizarId(id, 'Categoria')]
  );

  if (!result.rows.length) {
    throw new Error('Categoria de saída não encontrada');
  }

  return result.rows[0];
}

async function criar(data = {}) {
  const nome = normalizarTexto(data.nome);
  const ativo = data.ativo === undefined ? true : parseAtivo(data.ativo);
  const observacao = normalizarTexto(data.observacao) || null;

  if (!nome) throw new Error('Nome é obrigatório');
  if (await nomeJaExiste(nome)) throw new Error('Já existe uma categoria de saída com este nome');

  const result = await pool.query(
    `INSERT INTO despesa_categorias (nome, ativo, observacao)
     VALUES ($1, $2, $3)
     RETURNING id, nome, ativo, observacao, created_at, updated_at`,
    [nome, ativo, observacao]
  );

  return result.rows[0];
}

async function atualizar(id, data = {}) {
  const categoriaId = normalizarId(id, 'Categoria');
  const atual = await buscar(categoriaId);

  const nome = data.nome !== undefined ? normalizarTexto(data.nome) : atual.nome;
  const ativo = data.ativo === undefined ? atual.ativo : parseAtivo(data.ativo);
  const observacao = data.observacao !== undefined ? (normalizarTexto(data.observacao) || null) : atual.observacao;

  if (!nome) throw new Error('Nome é obrigatório');
  if (await nomeJaExiste(nome, categoriaId)) throw new Error('Já existe uma categoria de saída com este nome');

  const result = await pool.query(
    `UPDATE despesa_categorias
     SET nome = $1,
         ativo = $2,
         observacao = $3,
         updated_at = NOW()
     WHERE id = $4
     RETURNING id, nome, ativo, observacao, created_at, updated_at`,
    [nome, ativo, observacao, categoriaId]
  );

  return result.rows[0];
}

async function excluir(id) {
  const categoriaId = normalizarId(id, 'Categoria');
  await buscar(categoriaId);

  const vinculados = await pool.query(
    'SELECT COUNT(*)::int AS total FROM despesa_itens WHERE categoria_id = $1',
    [categoriaId]
  );

  if (vinculados.rows[0].total > 0) {
    throw new Error('Não é possível excluir. Existem itens de saída vinculados a esta categoria.');
  }

  await pool.query('DELETE FROM despesa_categorias WHERE id = $1', [categoriaId]);
}

module.exports = {
  listar,
  buscar,
  criar,
  atualizar,
  excluir
};
