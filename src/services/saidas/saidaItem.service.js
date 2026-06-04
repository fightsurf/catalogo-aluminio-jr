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

function parseBoolean(value, campo) {
  if (value === undefined || value === null || value === '') return null;
  if (value === true || value === 'true' || value === '1' || value === 1) return true;
  if (value === false || value === 'false' || value === '0' || value === 0) return false;
  throw new Error(`${campo} inválido`);
}

async function categoriaExiste(id) {
  const result = await pool.query(
    'SELECT id FROM despesa_categorias WHERE id = $1',
    [normalizarId(id, 'Categoria')]
  );
  return result.rows.length > 0;
}

async function nomeJaExiste(nome, idIgnorar = null) {
  const values = [normalizarTexto(nome)];
  let query = `
    SELECT 1
    FROM despesa_itens
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
  const values = [];
  const conditions = [];

  if (filtros.nome) {
    values.push(`%${normalizarTexto(filtros.nome)}%`);
    conditions.push(`i.nome ILIKE $${values.length}`);
  }

  if (filtros.categoria_id) {
    values.push(normalizarId(filtros.categoria_id, 'Categoria'));
    conditions.push(`i.categoria_id = $${values.length}`);
  }

  const ativo = parseBoolean(filtros.ativo, 'Ativo');
  if (ativo !== null) {
    values.push(ativo);
    conditions.push(`i.ativo = $${values.length}`);
  }

  const recorrente = parseBoolean(filtros.recorrente_mensal, 'Recorrente mensal');
  if (recorrente !== null) {
    values.push(recorrente);
    conditions.push(`i.recorrente_mensal = $${values.length}`);
  }

  let query = `
    SELECT
      i.id,
      i.nome,
      i.categoria_id,
      c.nome AS categoria_nome,
      i.recorrente_mensal,
      i.ativo,
      i.observacao,
      i.created_at,
      i.updated_at
    FROM despesa_itens i
    JOIN despesa_categorias c ON c.id = i.categoria_id
  `;

  if (conditions.length) {
    query += ` WHERE ${conditions.join(' AND ')}`;
  }

  query += ' ORDER BY i.nome ASC';

  const result = await pool.query(query, values);
  return result.rows;
}

async function buscar(id) {
  const result = await pool.query(
    `SELECT
       i.id,
       i.nome,
       i.categoria_id,
       c.nome AS categoria_nome,
       i.recorrente_mensal,
       i.ativo,
       i.observacao,
       i.created_at,
       i.updated_at
     FROM despesa_itens i
     JOIN despesa_categorias c ON c.id = i.categoria_id
     WHERE i.id = $1`,
    [normalizarId(id, 'Item de saída')]
  );

  if (!result.rows.length) {
    throw new Error('Item de saída não encontrado');
  }

  return result.rows[0];
}

async function criar(data = {}) {
  const nome = normalizarTexto(data.nome);
  const categoriaId = normalizarId(data.categoria_id, 'Categoria');
  const recorrenteMensal = data.recorrente_mensal === undefined ? true : parseBoolean(data.recorrente_mensal, 'Recorrente mensal');
  const ativo = data.ativo === undefined ? true : parseBoolean(data.ativo, 'Ativo');
  const observacao = normalizarTexto(data.observacao) || null;

  if (!nome) throw new Error('Nome é obrigatório');
  if (!(await categoriaExiste(categoriaId))) throw new Error('Categoria de saída não encontrada');
  if (await nomeJaExiste(nome)) throw new Error('Já existe um item de saída com este nome');

  const result = await pool.query(
    `INSERT INTO despesa_itens (nome, categoria_id, recorrente_mensal, ativo, observacao)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, nome, categoria_id, recorrente_mensal, ativo, observacao, created_at, updated_at`,
    [nome, categoriaId, recorrenteMensal, ativo, observacao]
  );

  return result.rows[0];
}

async function atualizar(id, data = {}) {
  const itemId = normalizarId(id, 'Item de saída');
  const atual = await buscar(itemId);

  const nome = data.nome !== undefined ? normalizarTexto(data.nome) : atual.nome;
  const categoriaId = data.categoria_id !== undefined ? normalizarId(data.categoria_id, 'Categoria') : atual.categoria_id;
  const recorrenteMensal = data.recorrente_mensal === undefined ? atual.recorrente_mensal : parseBoolean(data.recorrente_mensal, 'Recorrente mensal');
  const ativo = data.ativo === undefined ? atual.ativo : parseBoolean(data.ativo, 'Ativo');
  const observacao = data.observacao !== undefined ? (normalizarTexto(data.observacao) || null) : atual.observacao;

  if (!nome) throw new Error('Nome é obrigatório');
  if (!(await categoriaExiste(categoriaId))) throw new Error('Categoria de saída não encontrada');
  if (await nomeJaExiste(nome, itemId)) throw new Error('Já existe um item de saída com este nome');

  const result = await pool.query(
    `UPDATE despesa_itens
     SET nome = $1,
         categoria_id = $2,
         recorrente_mensal = $3,
         ativo = $4,
         observacao = $5,
         updated_at = NOW()
     WHERE id = $6
     RETURNING id, nome, categoria_id, recorrente_mensal, ativo, observacao, created_at, updated_at`,
    [nome, categoriaId, recorrenteMensal, ativo, observacao, itemId]
  );

  return result.rows[0];
}

async function excluir(id) {
  const itemId = normalizarId(id, 'Item de saída');
  await buscar(itemId);

  const vinculados = await pool.query(
    'SELECT COUNT(*)::int AS total FROM despesa_lancamentos WHERE item_saida_id = $1',
    [itemId]
  );

  if (vinculados.rows[0].total > 0) {
    throw new Error('Não é possível excluir. Existem lançamentos vinculados a este item.');
  }

  await pool.query('DELETE FROM despesa_itens WHERE id = $1', [itemId]);
}

module.exports = {
  listar,
  buscar,
  criar,
  atualizar,
  excluir
};
