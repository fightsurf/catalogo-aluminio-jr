const pool = require('../../../db/connection');

const UNIDADES_VALIDAS = ['un', 'kg', 'g', 'm', 'cm', 'mm'];

function parseAtivo(value) {
  if (value === undefined || value === null || value === '') return null;
  if (value === true || value === 'true' || value === '1' || value === 1) return true;
  if (value === false || value === 'false' || value === '0' || value === 0) return false;
  throw new Error('Valor de ativo inválido');
}

function normalizarTexto(value) {
  return String(value || '').trim();
}

function normalizarUnidade(value) {
  const unidade = normalizarTexto(value).toLowerCase();
  if (!UNIDADES_VALIDAS.includes(unidade)) {
    throw new Error(`Unidade de medida inválida. Use: ${UNIDADES_VALIDAS.join(', ')}`);
  }
  return unidade;
}

function normalizarId(value, campo) {
  const numero = Number.parseInt(value, 10);
  if (!Number.isInteger(numero) || numero <= 0) {
    throw new Error(`${campo} inválido`);
  }
  return numero;
}

async function categoriaExiste(id) {
  const result = await pool.query('SELECT id FROM insumos_categorias WHERE id = $1', [id]);
  return result.rows.length > 0;
}

async function nomeJaExiste(nome, idIgnorar = null) {
  const values = [nome];
  let query = `
    SELECT 1
    FROM insumos i
    LEFT JOIN insumos_discos d ON d.insumo_id = i.id
    WHERE d.insumo_id IS NULL
      AND LOWER(TRIM(i.nome)) = LOWER(TRIM($1))
  `;

  if (idIgnorar) {
    values.push(idIgnorar);
    query += ` AND i.id <> $${values.length}`;
  }

  query += ' LIMIT 1';

  const result = await pool.query(query, values);
  return result.rows.length > 0;
}

async function listar(filtros = {}) {
  const values = [];
  const conditions = ['d.insumo_id IS NULL'];

  if (filtros.nome) {
    values.push(`%${normalizarTexto(filtros.nome)}%`);
    conditions.push(`i.nome ILIKE $${values.length}`);
  }

  if (filtros.categoria_insumo_id) {
    values.push(normalizarId(filtros.categoria_insumo_id, 'Categoria'));
    conditions.push(`i.categoria_insumo_id = $${values.length}`);
  }

  const ativo = parseAtivo(filtros.ativo);
  if (ativo !== null) {
    values.push(ativo);
    conditions.push(`i.ativo = $${values.length}`);
  }

  let query = `
    SELECT
      i.id,
      i.nome,
      i.categoria_insumo_id,
      c.nome AS categoria,
      i.unidade_medida,
      i.ativo
    FROM insumos i
    JOIN insumos_categorias c ON c.id = i.categoria_insumo_id
    LEFT JOIN insumos_discos d ON d.insumo_id = i.id
    WHERE ${conditions.join(' AND ')}
    ORDER BY i.nome ASC
  `;

  const result = await pool.query(query, values);
  return result.rows;
}

async function listarTodos(filtros = {}) {
  const values = [];
  const conditions = [];

  if (filtros.nome) {
    values.push(`%${normalizarTexto(filtros.nome)}%`);
    conditions.push(`i.nome ILIKE $${values.length}`);
  }

  const ativo = parseAtivo(filtros.ativo);
  if (ativo !== null) {
    values.push(ativo);
    conditions.push(`i.ativo = $${values.length}`);
  }

  let query = `
    SELECT
      i.id,
      i.nome,
      i.categoria_insumo_id,
      c.nome AS categoria,
      i.unidade_medida,
      i.ativo,
      (d.insumo_id IS NOT NULL) AS eh_disco,
      d.diametro_mm,
      d.espessura_mm,
      d.peso_kg
    FROM insumos i
    JOIN insumos_categorias c ON c.id = i.categoria_insumo_id
    LEFT JOIN insumos_discos d ON d.insumo_id = i.id
  `;

  if (conditions.length) {
    query += ` WHERE ${conditions.join(' AND ')}`;
  }

  query += ' ORDER BY i.nome ASC';

  const result = await pool.query(query, values);
  return result.rows;
}

async function buscar(id) {
  const result = await pool.query(`
    SELECT
      i.id,
      i.nome,
      i.categoria_insumo_id,
      c.nome AS categoria,
      i.unidade_medida,
      i.ativo
    FROM insumos i
    JOIN insumos_categorias c ON c.id = i.categoria_insumo_id
    LEFT JOIN insumos_discos d ON d.insumo_id = i.id
    WHERE i.id = $1
      AND d.insumo_id IS NULL
  `, [normalizarId(id, 'Insumo')]);

  if (result.rows.length === 0) {
    throw new Error('Insumo não encontrado');
  }

  return result.rows[0];
}

async function criar(data = {}) {
  const nome = normalizarTexto(data.nome);
  const categoriaId = normalizarId(data.categoria_insumo_id, 'Categoria');
  const unidadeMedida = normalizarUnidade(data.unidade_medida);
  const ativo = data.ativo === undefined ? true : parseAtivo(data.ativo);

  if (!nome) {
    throw new Error('Nome é obrigatório');
  }

  if (!(await categoriaExiste(categoriaId))) {
    throw new Error('Categoria de insumo não encontrada');
  }

  if (await nomeJaExiste(nome)) {
    throw new Error('Já existe um insumo com este nome');
  }

  const result = await pool.query(`
    INSERT INTO insumos (nome, categoria_insumo_id, unidade_medida, ativo)
    VALUES ($1, $2, $3, $4)
    RETURNING id, nome, categoria_insumo_id, unidade_medida, ativo
  `, [nome, categoriaId, unidadeMedida, ativo]);

  return result.rows[0];
}

async function atualizar(id, data = {}) {
  const atual = await buscar(id);

  const nome = data.nome !== undefined ? normalizarTexto(data.nome) : atual.nome;
  const categoriaId = data.categoria_insumo_id !== undefined
    ? normalizarId(data.categoria_insumo_id, 'Categoria')
    : atual.categoria_insumo_id;
  const unidadeMedida = data.unidade_medida !== undefined
    ? normalizarUnidade(data.unidade_medida)
    : atual.unidade_medida;
  const ativo = data.ativo === undefined ? atual.ativo : parseAtivo(data.ativo);

  if (!nome) {
    throw new Error('Nome é obrigatório');
  }

  if (!(await categoriaExiste(categoriaId))) {
    throw new Error('Categoria de insumo não encontrada');
  }

  if (await nomeJaExiste(nome, Number(id))) {
    throw new Error('Já existe um insumo com este nome');
  }

  const result = await pool.query(`
    UPDATE insumos
    SET nome = $1,
        categoria_insumo_id = $2,
        unidade_medida = $3,
        ativo = $4,
        updated_at = NOW()
    WHERE id = $5
    RETURNING id, nome, categoria_insumo_id, unidade_medida, ativo
  `, [nome, categoriaId, unidadeMedida, ativo, Number(id)]);

  return result.rows[0];
}

async function excluir(id) {
  const insumoId = normalizarId(id, 'Insumo');
  await buscar(insumoId);

  const vinculoFornecedor = await pool.query(
    'SELECT COUNT(*)::int AS total FROM insumos_fornecedores WHERE insumo_id = $1',
    [insumoId]
  );

  if (vinculoFornecedor.rows[0].total > 0) {
    throw new Error('Não é possível excluir. Existem custos por fornecedor vinculados a este insumo.');
  }

  const result = await pool.query('DELETE FROM insumos WHERE id = $1 RETURNING id', [insumoId]);

  if (result.rows.length === 0) {
    throw new Error('Insumo não encontrado');
  }
}

module.exports = {
  listar,
  listarTodos,
  buscar,
  criar,
  atualizar,
  excluir,
  UNIDADES_VALIDAS
};
