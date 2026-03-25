const pool = require('../../../db/connection');

function normalizarItemLegado(valor) {
  if (valor === undefined || valor === null || `${valor}`.trim() === '') {
    return null;
  }

  const numero = Number.parseInt(valor, 10);

  if (!Number.isInteger(numero) || numero <= 0) {
    throw new Error('ITEM do legado inválido.');
  }

  return numero;
}

async function listar(filtros = {}) {
  let query = `
    SELECT 
      p.id,
      p.nome,
      p.preco,
      p.foto,
      p.capacidade_caixa,
      p.ativo,
      p.item_legado,
      c.id AS categoria_id,
      c.nome AS categoria
    FROM produtos p
    LEFT JOIN produtos_categorias c 
      ON p.categoria_id = c.id
    WHERE 1=1
  `;

  const values = [];

  if (filtros.busca) {
    values.push(`%${filtros.busca}%`);
    query += ` AND p.nome ILIKE $${values.length}`;
  }

  if (filtros.apenasAtivos) {
    query += ` AND p.ativo = true`;
  }

  query += ` ORDER BY p.nome ASC`;

  const result = await pool.query(query, values);

  return result.rows;
}

async function buscar(id) {
  const result = await pool.query(`
    SELECT 
      p.id,
      p.nome,
      p.preco,
      p.foto,
      p.capacidade_caixa,
      p.ativo,
      p.item_legado,
      c.id AS categoria_id,
      c.nome AS categoria
    FROM produtos p
    LEFT JOIN produtos_categorias c 
      ON p.categoria_id = c.id
    WHERE p.id = $1
  `, [id]);

  if (result.rows.length === 0) {
    throw new Error('Produto não encontrado');
  }

  return result.rows[0];
}

async function criar(data) {
  const { nome, preco, categoria_id, foto, capacidade_caixa, ativo } = data;
  const itemLegado = normalizarItemLegado(data?.item_legado);

  const result = await pool.query(`
    INSERT INTO produtos
    (nome, preco, categoria_id, foto, capacidade_caixa, ativo, item_legado)
    VALUES ($1,$2,$3,$4,$5,$6,$7)
    RETURNING *
  `, [
    nome,
    preco,
    categoria_id || null,
    foto || null,
    capacidade_caixa || 1,
    ativo !== false,
    itemLegado
  ]);

  return result.rows[0];
}

async function atualizar(id, data) {
  const { nome, preco, categoria_id, foto, capacidade_caixa, ativo } = data;

  const result = await pool.query(`
    UPDATE produtos SET
      nome = $1,
      preco = $2,
      categoria_id = $3,
      foto = $4,
      capacidade_caixa = $5,
      ativo = $6,
      updated_at = NOW()
    WHERE id = $7
    RETURNING *
  `, [
    nome,
    preco,
    categoria_id || null,
    foto || null,
    capacidade_caixa || 1,
    ativo !== false,
    id
  ]);

  if (result.rows.length === 0) {
    throw new Error('Produto não encontrado');
  }

  return result.rows[0];
}

async function associarItemLegado(produtoId, itemLegado) {
  const itemNormalizado = normalizarItemLegado(itemLegado);

  try {
    const result = await pool.query(`
      UPDATE produtos
      SET item_legado = $1,
          updated_at = NOW()
      WHERE id = $2
      RETURNING id, nome, preco, foto, capacidade_caixa, ativo, item_legado, categoria_id
    `, [itemNormalizado, produtoId]);

    if (result.rows.length === 0) {
      throw new Error('Produto não encontrado');
    }

    return result.rows[0];
  } catch (error) {
    if (error?.code === '23505') {
      throw new Error(`O ITEM legado ${itemNormalizado} já está associado a outro produto no PostgreSQL.`);
    }

    throw error;
  }
}

async function desassociarItemLegado(produtoId) {
  const result = await pool.query(`
    UPDATE produtos
    SET item_legado = NULL,
        updated_at = NOW()
    WHERE id = $1
    RETURNING id, nome, preco, foto, capacidade_caixa, ativo, item_legado, categoria_id
  `, [produtoId]);

  if (result.rows.length === 0) {
    throw new Error('Produto não encontrado');
  }

  return result.rows[0];
}

async function transferirItemLegado(produtoIdDestino, itemLegado) {
  const itemNormalizado = normalizarItemLegado(itemLegado);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const produtoDestinoResult = await client.query(`
      SELECT id, nome, item_legado
      FROM produtos
      WHERE id = $1
      FOR UPDATE
    `, [produtoIdDestino]);

    if (produtoDestinoResult.rows.length === 0) {
      throw new Error('Produto de destino não encontrado.');
    }

    const produtoDestino = produtoDestinoResult.rows[0];

    const produtoAtualResult = await client.query(`
      SELECT id, nome, item_legado
      FROM produtos
      WHERE item_legado = $1
      FOR UPDATE
    `, [itemNormalizado]);

    const produtoAtual = produtoAtualResult.rows[0] || null;

    if (produtoAtual && Number(produtoAtual.id) !== Number(produtoDestino.id)) {
      await client.query(`
        UPDATE produtos
        SET item_legado = NULL,
            updated_at = NOW()
        WHERE id = $1
      `, [produtoAtual.id]);
    }

    const produtoAtualizadoResult = await client.query(`
      UPDATE produtos
      SET item_legado = $1,
          updated_at = NOW()
      WHERE id = $2
      RETURNING id, nome, preco, foto, capacidade_caixa, ativo, item_legado, categoria_id
    `, [itemNormalizado, produtoIdDestino]);

    await client.query('COMMIT');

    return {
      produto: produtoAtualizadoResult.rows[0],
      produtoAnterior: produtoAtual && Number(produtoAtual.id) !== Number(produtoIdDestino)
        ? produtoAtual
        : null
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function buscarPorItemLegado(itemLegado, opcoes = {}) {
  const itemNormalizado = normalizarItemLegado(itemLegado);

  if (itemNormalizado === null) {
    return null;
  }

  const values = [itemNormalizado];
  let query = `
    SELECT
      p.id,
      p.nome,
      p.preco,
      p.foto,
      p.capacidade_caixa,
      p.ativo,
      p.item_legado,
      p.categoria_id
    FROM produtos p
    WHERE p.item_legado = $1
  `;

  if (opcoes.ignorarProdutoId !== undefined && opcoes.ignorarProdutoId !== null && `${opcoes.ignorarProdutoId}` !== '') {
    values.push(opcoes.ignorarProdutoId);
    query += ` AND p.id <> $${values.length}`;
  }

  query += ' LIMIT 1';

  const result = await pool.query(query, values);

  return result.rows[0] || null;
}

async function excluir(id) {
  await pool.query(
    'DELETE FROM produtos WHERE id = $1',
    [id]
  );
}

module.exports = {
  listar,
  buscar,
  criar,
  atualizar,
  associarItemLegado,
  desassociarItemLegado,
  transferirItemLegado,
  buscarPorItemLegado,
  excluir
};
