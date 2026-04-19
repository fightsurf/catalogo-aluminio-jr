const pool = require('../../../db/connection');

const COEFICIENTE_PESO_DISCO = 0.0000021206;
const NOME_CATEGORIA_DISCOS = 'DISCOS DE ALUMÍNIO';

function parseAtivo(value) {
  if (value === undefined || value === null || value === '') return null;
  if (value === true || value === 'true' || value === '1' || value === 1) return true;
  if (value === false || value === 'false' || value === '0' || value === 0) return false;
  throw new Error('Valor de ativo inválido');
}

function normalizarNumeroPositivo(value, campo) {
  const numero = Number(String(value).replace(',', '.'));
  if (!Number.isFinite(numero) || numero <= 0) {
    throw new Error(`${campo} inválido`);
  }
  return numero;
}

function formatarDiametro(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.00$/, '').replace(/(\.[1-9])0$/, '$1');
}

function formatarEspessura(value) {
  return value.toFixed(2);
}

function montarNomeDisco(diametroMm, espessuraMm) {
  return `DISCO ${formatarDiametro(diametroMm)} X ${formatarEspessura(espessuraMm)}`;
}

function calcularPesoKg(diametroMm, espessuraMm) {
  const peso = diametroMm * diametroMm * espessuraMm * COEFICIENTE_PESO_DISCO;
  return Number(peso.toFixed(6));
}

async function obterOuCriarCategoriaDiscos(client) {
  const existente = await client.query(
    `SELECT id FROM insumos_categorias WHERE LOWER(TRIM(nome)) = LOWER(TRIM($1)) LIMIT 1`,
    [NOME_CATEGORIA_DISCOS]
  );

  if (existente.rows.length > 0) {
    return existente.rows[0].id;
  }

  const criada = await client.query(
    `INSERT INTO insumos_categorias (nome, ativo) VALUES ($1, true) RETURNING id`,
    [NOME_CATEGORIA_DISCOS]
  );

  return criada.rows[0].id;
}

async function medidasJaExistem(client, diametroMm, espessuraMm, idIgnorar = null) {
  const values = [diametroMm, espessuraMm];
  let query = `
    SELECT 1
    FROM insumos_discos
    WHERE diametro_mm = $1
      AND espessura_mm = $2
  `;

  if (idIgnorar) {
    values.push(idIgnorar);
    query += ` AND insumo_id <> $3`;
  }

  query += ' LIMIT 1';

  const result = await client.query(query, values);
  return result.rows.length > 0;
}

async function listar(filtros = {}) {
  const values = [];
  const conditions = [];

  if (filtros.nome) {
    values.push(`%${String(filtros.nome).trim()}%`);
    conditions.push(`i.nome ILIKE $${values.length}`);
  }

  if (filtros.diametro_mm) {
    values.push(normalizarNumeroPositivo(filtros.diametro_mm, 'Diâmetro'));
    conditions.push(`d.diametro_mm = $${values.length}`);
  }

  if (filtros.espessura_mm) {
    values.push(normalizarNumeroPositivo(filtros.espessura_mm, 'Espessura'));
    conditions.push(`d.espessura_mm = $${values.length}`);
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
      i.ativo,
      d.diametro_mm,
      d.espessura_mm,
      d.peso_kg
    FROM insumos i
    JOIN insumos_discos d ON d.insumo_id = i.id
  `;

  if (conditions.length) {
    query += ` WHERE ${conditions.join(' AND ')}`;
  }

  query += ' ORDER BY d.diametro_mm ASC, d.espessura_mm ASC';

  const result = await pool.query(query, values);
  return result.rows;
}

async function buscar(id) {
  const insumoId = Number.parseInt(id, 10);
  if (!Number.isInteger(insumoId) || insumoId <= 0) {
    throw new Error('Disco de alumínio não encontrado');
  }

  const result = await pool.query(`
    SELECT
      i.id,
      i.nome,
      i.ativo,
      i.categoria_insumo_id,
      i.unidade_medida,
      d.diametro_mm,
      d.espessura_mm,
      d.peso_kg
    FROM insumos i
    JOIN insumos_discos d ON d.insumo_id = i.id
    WHERE i.id = $1
  `, [insumoId]);

  if (result.rows.length === 0) {
    throw new Error('Disco de alumínio não encontrado');
  }

  return result.rows[0];
}

async function criar(data = {}) {
  const client = await pool.connect();

  try {
    const diametroMm = normalizarNumeroPositivo(data.diametro_mm, 'Diâmetro');
    const espessuraMm = normalizarNumeroPositivo(data.espessura_mm, 'Espessura');
    const ativo = data.ativo === undefined ? true : parseAtivo(data.ativo);
    const nome = montarNomeDisco(diametroMm, espessuraMm);
    const pesoKg = calcularPesoKg(diametroMm, espessuraMm);

    await client.query('BEGIN');

    if (await medidasJaExistem(client, diametroMm, espessuraMm)) {
      throw new Error('Já existe um disco com este diâmetro e espessura');
    }

    const categoriaId = await obterOuCriarCategoriaDiscos(client);

    const insumoResult = await client.query(`
      INSERT INTO insumos (nome, categoria_insumo_id, unidade_medida, ativo)
      VALUES ($1, $2, 'un', $3)
      RETURNING id, nome, categoria_insumo_id, unidade_medida, ativo
    `, [nome, categoriaId, ativo]);

    const insumoId = insumoResult.rows[0].id;

    await client.query(`
      INSERT INTO insumos_discos (insumo_id, diametro_mm, espessura_mm, peso_kg)
      VALUES ($1, $2, $3, $4)
    `, [insumoId, diametroMm, espessuraMm, pesoKg]);

    await client.query('COMMIT');

    return {
      ...insumoResult.rows[0],
      diametro_mm: diametroMm,
      espessura_mm: espessuraMm,
      peso_kg: pesoKg
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function atualizar(id, data = {}) {
  const client = await pool.connect();

  try {
    const atual = await buscar(id);
    const diametroMm = data.diametro_mm !== undefined
      ? normalizarNumeroPositivo(data.diametro_mm, 'Diâmetro')
      : Number(atual.diametro_mm);
    const espessuraMm = data.espessura_mm !== undefined
      ? normalizarNumeroPositivo(data.espessura_mm, 'Espessura')
      : Number(atual.espessura_mm);
    const ativo = data.ativo === undefined ? atual.ativo : parseAtivo(data.ativo);
    const nome = montarNomeDisco(diametroMm, espessuraMm);
    const pesoKg = calcularPesoKg(diametroMm, espessuraMm);

    await client.query('BEGIN');

    if (await medidasJaExistem(client, diametroMm, espessuraMm, Number(id))) {
      throw new Error('Já existe um disco com este diâmetro e espessura');
    }

    await client.query(`
      UPDATE insumos
      SET nome = $1,
          ativo = $2,
          updated_at = NOW()
      WHERE id = $3
    `, [nome, ativo, Number(id)]);

    await client.query(`
      UPDATE insumos_discos
      SET diametro_mm = $1,
          espessura_mm = $2,
          peso_kg = $3,
          updated_at = NOW()
      WHERE insumo_id = $4
    `, [diametroMm, espessuraMm, pesoKg, Number(id)]);

    await client.query('COMMIT');

    return {
      id: Number(id),
      nome,
      ativo,
      categoria_insumo_id: atual.categoria_insumo_id,
      unidade_medida: atual.unidade_medida,
      diametro_mm: diametroMm,
      espessura_mm: espessuraMm,
      peso_kg: pesoKg
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function excluir(id) {
  const insumoId = Number.parseInt(id, 10);
  if (!Number.isInteger(insumoId) || insumoId <= 0) {
    throw new Error('Disco de alumínio não encontrado');
  }

  await buscar(insumoId);

  const vinculos = await pool.query(
    'SELECT COUNT(*)::int AS total FROM insumos_fornecedores WHERE insumo_id = $1',
    [insumoId]
  );

  if (vinculos.rows[0].total > 0) {
    throw new Error('Não é possível excluir. Existem custos por fornecedor vinculados a este disco.');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM insumos_discos WHERE insumo_id = $1', [insumoId]);
    await client.query('DELETE FROM insumos WHERE id = $1', [insumoId]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  listar,
  buscar,
  criar,
  atualizar,
  excluir,
  calcularPesoKg,
  montarNomeDisco,
  COEFICIENTE_PESO_DISCO,
  NOME_CATEGORIA_DISCOS
};
