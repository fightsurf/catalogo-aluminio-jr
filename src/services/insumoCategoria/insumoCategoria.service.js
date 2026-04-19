const pool = require('../../../db/connection');

function parseAtivo(value) {
  if (value === undefined || value === null || value === '') return null;
  if (value === true || value === 'true' || value === '1' || value === 1) return true;
  if (value === false || value === 'false' || value === '0' || value === 0) return false;
  throw new Error('Valor de ativo inválido');
}

async function nomeJaExiste(nome, idIgnorar = null) {
  const values = [String(nome || '').trim()];
  let query = `
    SELECT 1
    FROM insumos_categorias
    WHERE LOWER(TRIM(nome)) = LOWER(TRIM($1))
  `;

  if (idIgnorar) {
    values.push(idIgnorar);
    query += ' AND id <> $2';
  }

  query += ' LIMIT 1';

  const result = await pool.query(query, values);
  return result.rows.length > 0;
}

async function listar(filtros = {}) {
  const conditions = [];
  const values = [];

  if (filtros.nome) {
    values.push(`%${String(filtros.nome).trim()}%`);
    conditions.push(`nome ILIKE $${values.length}`);
  }

  const ativo = parseAtivo(filtros.ativo);
  if (ativo !== null) {
    values.push(ativo);
    conditions.push(`ativo = $${values.length}`);
  }

  let query = `
    SELECT id, nome, ativo
    FROM insumos_categorias
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
    'SELECT id, nome, ativo FROM insumos_categorias WHERE id = $1',
    [id]
  );

  if (result.rows.length === 0) {
    throw new Error('Categoria de insumo não encontrada');
  }

  return result.rows[0];
}

async function criar(data = {}) {
  const nome = String(data.nome || '').trim();
  const ativo = data.ativo === undefined ? true : parseAtivo(data.ativo);

  if (!nome) {
    throw new Error('Nome é obrigatório');
  }

  if (await nomeJaExiste(nome)) {
    throw new Error('Já existe uma categoria de insumo com este nome');
  }

  const result = await pool.query(
    `INSERT INTO insumos_categorias (nome, ativo)
     VALUES ($1, $2)
     RETURNING id, nome, ativo`,
    [nome, ativo]
  );

  return result.rows[0];
}

async function atualizar(id, data = {}) {
  const atual = await buscar(id);
  const nome = data.nome !== undefined ? String(data.nome).trim() : atual.nome;
  const ativo = data.ativo === undefined ? atual.ativo : parseAtivo(data.ativo);

  if (!nome) {
    throw new Error('Nome é obrigatório');
  }

  if (await nomeJaExiste(nome, id)) {
    throw new Error('Já existe uma categoria de insumo com este nome');
  }

  const result = await pool.query(
    `UPDATE insumos_categorias
     SET nome = $1,
         ativo = $2
     WHERE id = $3
     RETURNING id, nome, ativo`,
    [nome, ativo, id]
  );

  return result.rows[0];
}

async function excluir(id) {
  const tabelaInsumos = await pool.query(`SELECT to_regclass('public.insumos') AS tabela`);

  if (tabelaInsumos.rows[0]?.tabela) {
    const vinculos = await pool.query(
      'SELECT COUNT(*)::int AS total FROM insumos WHERE categoria_insumo_id = $1',
      [id]
    );

    if (vinculos.rows[0].total > 0) {
      throw new Error('Não é possível excluir. Existem insumos vinculados a esta categoria.');
    }
  }

  const result = await pool.query(
    'DELETE FROM insumos_categorias WHERE id = $1 RETURNING id',
    [id]
  );

  if (result.rows.length === 0) {
    throw new Error('Categoria de insumo não encontrada');
  }
}

module.exports = {
  listar,
  buscar,
  criar,
  atualizar,
  excluir
};
