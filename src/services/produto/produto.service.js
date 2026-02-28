const pool = require('../../../db/connection');

async function listar() {
  const result = await pool.query(`
    SELECT 
      p.id,
      p.nome,
      p.preco,
      p.foto,
      p.capacidade_caixa,
      p.ativo,
      c.id AS categoria_id,
      c.nome AS categoria
    FROM produtos p
    LEFT JOIN produtos_categorias c 
      ON p.categoria_id = c.id
    ORDER BY c.nome, p.nome
  `);

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

  const result = await pool.query(`
    INSERT INTO produtos
    (nome, preco, categoria_id, foto, capacidade_caixa, ativo)
    VALUES ($1,$2,$3,$4,$5,$6)
    RETURNING *
  `, [
    nome,
    preco,
    categoria_id || null,
    foto || null,
    capacidade_caixa || 1,
    ativo !== false
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
  excluir
};
