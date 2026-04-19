const pool = require('../../../db/connection');

function parseAtivo(value) {
  if (value === undefined || value === null || value === '') return null;
  if (value === true || value === 'true' || value === '1' || value === 1) return true;
  if (value === false || value === 'false' || value === '0' || value === 0) return false;
  throw new Error('Valor de ativo inválido');
}

function normalizarId(value, campo) {
  const numero = Number.parseInt(value, 10);
  if (!Number.isInteger(numero) || numero <= 0) {
    throw new Error(`${campo} inválido`);
  }
  return numero;
}

function normalizarTexto(value) {
  return String(value || '').trim();
}

function normalizarMoeda(value, campo) {
  if (value === undefined || value === null || value === '') return 0;

  let texto = String(value).trim();

  if (texto.includes(',') && texto.includes('.')) {
    texto = texto.replace(/\./g, '').replace(',', '.');
  } else if (texto.includes(',')) {
    texto = texto.replace(',', '.');
  }

  const numero = Number(texto);
  if (!Number.isFinite(numero) || numero < 0) {
    throw new Error(`${campo} inválido`);
  }
  return Number(numero.toFixed(4));
}

function calcularCustoFinal(data) {
  const custo = (data.preco_base || 0)
    + (data.impostos_valor || 0)
    + (data.frete_valor || 0)
    + (data.outras_despesas_valor || 0)
    - (data.desconto_valor || 0);

  return Number(custo.toFixed(4));
}

async function obterInsumo(id) {
  const result = await pool.query(`
    SELECT
      i.id,
      i.nome,
      i.unidade_medida,
      i.ativo,
      i.categoria_insumo_id,
      c.nome AS categoria,
      (d.insumo_id IS NOT NULL) AS eh_disco,
      d.diametro_mm,
      d.espessura_mm,
      d.peso_kg
    FROM insumos i
    JOIN insumos_categorias c ON c.id = i.categoria_insumo_id
    LEFT JOIN insumos_discos d ON d.insumo_id = i.id
    WHERE i.id = $1
  `, [id]);

  if (result.rows.length === 0) {
    throw new Error('Insumo não encontrado');
  }

  return result.rows[0];
}

async function obterFornecedor(id) {
  const result = await pool.query('SELECT id, nome FROM fornecedores WHERE id = $1', [id]);
  if (result.rows.length === 0) {
    throw new Error('Fornecedor não encontrado');
  }
  return result.rows[0];
}

async function combinacaoJaExiste(insumoId, fornecedorId, idIgnorar = null) {
  const values = [insumoId, fornecedorId];
  let query = `
    SELECT 1
    FROM insumos_fornecedores
    WHERE insumo_id = $1
      AND fornecedor_id = $2
  `;

  if (idIgnorar) {
    values.push(idIgnorar);
    query += ` AND id <> $3`;
  }

  query += ' LIMIT 1';

  const result = await pool.query(query, values);
  return result.rows.length > 0;
}

function mapearRegistro(row) {
  return {
    id: row.id,
    insumo_id: row.insumo_id,
    insumo: row.insumo,
    categoria_insumo_id: row.categoria_insumo_id,
    categoria: row.categoria,
    fornecedor_id: row.fornecedor_id,
    fornecedor: row.fornecedor,
    unidade_custo: row.unidade_custo,
    preco_base: Number(row.preco_base),
    impostos_valor: Number(row.impostos_valor),
    frete_valor: Number(row.frete_valor),
    outras_despesas_valor: Number(row.outras_despesas_valor),
    desconto_valor: Number(row.desconto_valor),
    custo_final: Number(row.custo_final),
    ativo: row.ativo,
    eh_disco: row.eh_disco,
    diametro_mm: row.diametro_mm !== null ? Number(row.diametro_mm) : null,
    espessura_mm: row.espessura_mm !== null ? Number(row.espessura_mm) : null,
    peso_kg: row.peso_kg !== null ? Number(row.peso_kg) : null
  };
}

async function listar(filtros = {}) {
  const values = [];
  const conditions = [];

  if (filtros.insumo) {
    values.push(`%${normalizarTexto(filtros.insumo)}%`);
    conditions.push(`i.nome ILIKE $${values.length}`);
  }

  if (filtros.categoria_insumo_id) {
    values.push(normalizarId(filtros.categoria_insumo_id, 'Categoria'));
    conditions.push(`i.categoria_insumo_id = $${values.length}`);
  }

  if (filtros.fornecedor_id) {
    values.push(normalizarId(filtros.fornecedor_id, 'Fornecedor'));
    conditions.push(`f.id = $${values.length}`);
  }

  const ativo = parseAtivo(filtros.ativo);
  if (ativo !== null) {
    values.push(ativo);
    conditions.push(`ifn.ativo = $${values.length}`);
  }

  let query = `
    SELECT
      ifn.id,
      ifn.insumo_id,
      i.nome AS insumo,
      i.categoria_insumo_id,
      c.nome AS categoria,
      ifn.fornecedor_id,
      f.nome AS fornecedor,
      ifn.unidade_custo,
      ifn.preco_base,
      ifn.impostos_valor,
      ifn.frete_valor,
      ifn.outras_despesas_valor,
      ifn.desconto_valor,
      ifn.custo_final,
      ifn.ativo,
      (d.insumo_id IS NOT NULL) AS eh_disco,
      d.diametro_mm,
      d.espessura_mm,
      d.peso_kg
    FROM insumos_fornecedores ifn
    JOIN insumos i ON i.id = ifn.insumo_id
    JOIN insumos_categorias c ON c.id = i.categoria_insumo_id
    JOIN fornecedores f ON f.id = ifn.fornecedor_id
    LEFT JOIN insumos_discos d ON d.insumo_id = i.id
  `;

  if (conditions.length) {
    query += ` WHERE ${conditions.join(' AND ')}`;
  }

  query += ' ORDER BY i.nome ASC, f.nome ASC';

  const result = await pool.query(query, values);
  return result.rows.map(mapearRegistro);
}

async function buscar(id) {
  const result = await pool.query(`
    SELECT
      ifn.id,
      ifn.insumo_id,
      i.nome AS insumo,
      i.categoria_insumo_id,
      c.nome AS categoria,
      ifn.fornecedor_id,
      f.nome AS fornecedor,
      ifn.unidade_custo,
      ifn.preco_base,
      ifn.impostos_valor,
      ifn.frete_valor,
      ifn.outras_despesas_valor,
      ifn.desconto_valor,
      ifn.custo_final,
      ifn.ativo,
      (d.insumo_id IS NOT NULL) AS eh_disco,
      d.diametro_mm,
      d.espessura_mm,
      d.peso_kg
    FROM insumos_fornecedores ifn
    JOIN insumos i ON i.id = ifn.insumo_id
    JOIN insumos_categorias c ON c.id = i.categoria_insumo_id
    JOIN fornecedores f ON f.id = ifn.fornecedor_id
    LEFT JOIN insumos_discos d ON d.insumo_id = i.id
    WHERE ifn.id = $1
  `, [normalizarId(id, 'Registro de custo')]);

  if (result.rows.length === 0) {
    throw new Error('Registro de custo não encontrado');
  }

  return mapearRegistro(result.rows[0]);
}

async function criar(data = {}) {
  const insumoId = normalizarId(data.insumo_id, 'Insumo');
  const fornecedorId = normalizarId(data.fornecedor_id, 'Fornecedor');
  const insumo = await obterInsumo(insumoId);
  await obterFornecedor(fornecedorId);

  if (await combinacaoJaExiste(insumoId, fornecedorId)) {
    throw new Error('Já existe um custo cadastrado para este insumo e fornecedor');
  }

  const payload = {
    preco_base: normalizarMoeda(data.preco_base, 'Preço base'),
    impostos_valor: normalizarMoeda(data.impostos_valor, 'Impostos'),
    frete_valor: normalizarMoeda(data.frete_valor, 'Frete'),
    outras_despesas_valor: normalizarMoeda(data.outras_despesas_valor, 'Outras despesas'),
    desconto_valor: normalizarMoeda(data.desconto_valor, 'Desconto')
  };

  const unidadeCusto = insumo.eh_disco ? 'kg' : insumo.unidade_medida;
  const custoFinal = calcularCustoFinal(payload);
  const ativo = data.ativo === undefined ? true : parseAtivo(data.ativo);

  const result = await pool.query(`
    INSERT INTO insumos_fornecedores (
      insumo_id,
      fornecedor_id,
      unidade_custo,
      preco_base,
      impostos_valor,
      frete_valor,
      outras_despesas_valor,
      desconto_valor,
      custo_final,
      ativo
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    RETURNING id
  `, [
    insumoId,
    fornecedorId,
    unidadeCusto,
    payload.preco_base,
    payload.impostos_valor,
    payload.frete_valor,
    payload.outras_despesas_valor,
    payload.desconto_valor,
    custoFinal,
    ativo
  ]);

  return buscar(result.rows[0].id);
}

async function atualizar(id, data = {}) {
  const atual = await buscar(id);
  const insumoId = data.insumo_id !== undefined ? normalizarId(data.insumo_id, 'Insumo') : atual.insumo_id;
  const fornecedorId = data.fornecedor_id !== undefined ? normalizarId(data.fornecedor_id, 'Fornecedor') : atual.fornecedor_id;
  const insumo = await obterInsumo(insumoId);
  await obterFornecedor(fornecedorId);

  if (await combinacaoJaExiste(insumoId, fornecedorId, Number(id))) {
    throw new Error('Já existe um custo cadastrado para este insumo e fornecedor');
  }

  const payload = {
    preco_base: data.preco_base !== undefined ? normalizarMoeda(data.preco_base, 'Preço base') : atual.preco_base,
    impostos_valor: data.impostos_valor !== undefined ? normalizarMoeda(data.impostos_valor, 'Impostos') : atual.impostos_valor,
    frete_valor: data.frete_valor !== undefined ? normalizarMoeda(data.frete_valor, 'Frete') : atual.frete_valor,
    outras_despesas_valor: data.outras_despesas_valor !== undefined ? normalizarMoeda(data.outras_despesas_valor, 'Outras despesas') : atual.outras_despesas_valor,
    desconto_valor: data.desconto_valor !== undefined ? normalizarMoeda(data.desconto_valor, 'Desconto') : atual.desconto_valor
  };

  const unidadeCusto = insumo.eh_disco ? 'kg' : insumo.unidade_medida;
  const custoFinal = calcularCustoFinal(payload);
  const ativo = data.ativo === undefined ? atual.ativo : parseAtivo(data.ativo);

  await pool.query(`
    UPDATE insumos_fornecedores
    SET insumo_id = $1,
        fornecedor_id = $2,
        unidade_custo = $3,
        preco_base = $4,
        impostos_valor = $5,
        frete_valor = $6,
        outras_despesas_valor = $7,
        desconto_valor = $8,
        custo_final = $9,
        ativo = $10,
        updated_at = NOW()
    WHERE id = $11
  `, [
    insumoId,
    fornecedorId,
    unidadeCusto,
    payload.preco_base,
    payload.impostos_valor,
    payload.frete_valor,
    payload.outras_despesas_valor,
    payload.desconto_valor,
    custoFinal,
    ativo,
    Number(id)
  ]);

  return buscar(id);
}

async function inativar(id) {
  const atual = await buscar(id);

  await pool.query(`
    UPDATE insumos_fornecedores
    SET ativo = false,
        updated_at = NOW()
    WHERE id = $1
  `, [Number(id)]);

  return { ...atual, ativo: false };
}

module.exports = {
  listar,
  buscar,
  criar,
  atualizar,
  inativar,
  calcularCustoFinal
};
