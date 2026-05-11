const pool = require('../../../db/connection');

async function criarEstrutura() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS produtos_composicoes (
        id SERIAL PRIMARY KEY,
        produto_id INTEGER NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
        nome VARCHAR(120) NOT NULL DEFAULT 'COMPOSIÇÃO ÚNICA',
        ativo BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      ALTER TABLE produtos_composicoes
        ADD COLUMN IF NOT EXISTS nome VARCHAR(120) NOT NULL DEFAULT 'COMPOSIÇÃO ÚNICA',
        ADD COLUMN IF NOT EXISTS ativo BOOLEAN NOT NULL DEFAULT TRUE,
        ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
        ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS produtos_composicoes_itens (
        id SERIAL PRIMARY KEY,
        composicao_id INTEGER NOT NULL REFERENCES produtos_composicoes(id) ON DELETE CASCADE,
        insumo_fornecedor_id INTEGER NOT NULL REFERENCES insumos_fornecedores(id),
        quantidade NUMERIC(14,4) NOT NULL CHECK (quantidade > 0),
        ativo BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      ALTER TABLE produtos_composicoes_itens
        ADD COLUMN IF NOT EXISTS ativo BOOLEAN NOT NULL DEFAULT TRUE,
        ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
        ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
    `);

    // Regra atual: 1 produto = 1 composição.
    // Se alguma versão antiga tiver criado mais de uma composição por produto,
    // mantém a mais recente e remove as demais antes de criar o índice único.
    await client.query(`
      WITH repetidas AS (
        SELECT id
        FROM (
          SELECT
            id,
            produto_id,
            ROW_NUMBER() OVER (
              PARTITION BY produto_id
              ORDER BY updated_at DESC NULLS LAST, id DESC
            ) AS rn
          FROM produtos_composicoes
        ) x
        WHERE rn > 1
      )
      DELETE FROM produtos_composicoes_itens
      WHERE composicao_id IN (SELECT id FROM repetidas)
    `);

    await client.query(`
      WITH repetidas AS (
        SELECT id
        FROM (
          SELECT
            id,
            produto_id,
            ROW_NUMBER() OVER (
              PARTITION BY produto_id
              ORDER BY updated_at DESC NULLS LAST, id DESC
            ) AS rn
          FROM produtos_composicoes
        ) x
        WHERE rn > 1
      )
      DELETE FROM produtos_composicoes
      WHERE id IN (SELECT id FROM repetidas)
    `);

    await client.query(`
      UPDATE produtos_composicoes
      SET nome = 'COMPOSIÇÃO ÚNICA',
          ativo = TRUE,
          updated_at = NOW()
    `);

    await client.query(`
      WITH itens_repetidos AS (
        SELECT id
        FROM (
          SELECT
            id,
            ROW_NUMBER() OVER (
              PARTITION BY composicao_id, insumo_fornecedor_id
              ORDER BY updated_at DESC NULLS LAST, id DESC
            ) AS rn
          FROM produtos_composicoes_itens
        ) x
        WHERE rn > 1
      )
      DELETE FROM produtos_composicoes_itens
      WHERE id IN (SELECT id FROM itens_repetidos)
    `);

    await client.query('DROP INDEX IF EXISTS ux_produtos_composicoes_produto_nome');
    await client.query('DROP INDEX IF EXISTS idx_produtos_composicoes_um_principal_por_produto');

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS ux_produtos_composicoes_produto_unico
      ON produtos_composicoes (produto_id)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_produtos_composicoes_produto_id
      ON produtos_composicoes (produto_id)
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS ux_produtos_composicoes_itens_comp_ifn
      ON produtos_composicoes_itens (composicao_id, insumo_fornecedor_id)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_produtos_composicoes_itens_composicao_id
      ON produtos_composicoes_itens (composicao_id)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_produtos_composicoes_itens_insumo_fornecedor_id
      ON produtos_composicoes_itens (insumo_fornecedor_id)
    `);

    await client.query('COMMIT');
    console.log('🟢 Estrutura de composição/custos dos produtos verificada');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  criarEstrutura
};
