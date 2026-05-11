const pool = require('../../../db/connection');

async function criarEstrutura() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS saida_categorias (
      id SERIAL PRIMARY KEY,
      nome VARCHAR(160) NOT NULL,
      ativo BOOLEAN NOT NULL DEFAULT TRUE,
      observacao TEXT,
      created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
    );

    CREATE UNIQUE INDEX IF NOT EXISTS ux_saida_categorias_nome_lower
      ON saida_categorias (LOWER(TRIM(nome)));

    CREATE TABLE IF NOT EXISTS saida_itens (
      id SERIAL PRIMARY KEY,
      nome VARCHAR(180) NOT NULL,
      categoria_id INTEGER NOT NULL REFERENCES saida_categorias(id),
      recorrente_mensal BOOLEAN NOT NULL DEFAULT TRUE,
      ativo BOOLEAN NOT NULL DEFAULT TRUE,
      observacao TEXT,
      created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
    );

    CREATE UNIQUE INDEX IF NOT EXISTS ux_saida_itens_nome_lower
      ON saida_itens (LOWER(TRIM(nome)));

    CREATE INDEX IF NOT EXISTS ix_saida_itens_categoria_id
      ON saida_itens (categoria_id);

    CREATE TABLE IF NOT EXISTS saidas (
      id SERIAL PRIMARY KEY,
      item_saida_id INTEGER NOT NULL REFERENCES saida_itens(id),
      competencia_mes INTEGER NOT NULL CHECK (competencia_mes BETWEEN 1 AND 12),
      competencia_ano INTEGER NOT NULL CHECK (competencia_ano BETWEEN 2000 AND 2100),
      vencimento DATE,
      data_saida DATE,
      valor NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (valor >= 0),
      forma_pagamento VARCHAR(60),
      status VARCHAR(20) NOT NULL DEFAULT 'PAGO' CHECK (status IN ('PAGO', 'PENDENTE', 'CANCELADO')),
      observacao TEXT,
      lote_carne VARCHAR(80),
      numero_parcela INTEGER,
      total_parcelas INTEGER,
      created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
    );

    ALTER TABLE saidas
      ADD COLUMN IF NOT EXISTS vencimento DATE;

    ALTER TABLE saidas
      ADD COLUMN IF NOT EXISTS lote_carne VARCHAR(80);

    ALTER TABLE saidas
      ADD COLUMN IF NOT EXISTS numero_parcela INTEGER;

    ALTER TABLE saidas
      ADD COLUMN IF NOT EXISTS total_parcelas INTEGER;

    ALTER TABLE saidas
      DROP COLUMN IF EXISTS descricao;

    CREATE INDEX IF NOT EXISTS ix_saidas_competencia
      ON saidas (competencia_ano, competencia_mes);

    CREATE INDEX IF NOT EXISTS ix_saidas_item_saida_id
      ON saidas (item_saida_id);

    CREATE INDEX IF NOT EXISTS ix_saidas_status
      ON saidas (status);

    CREATE INDEX IF NOT EXISTS ix_saidas_vencimento
      ON saidas (vencimento);

    CREATE INDEX IF NOT EXISTS ix_saidas_lote_carne
      ON saidas (lote_carne);
  `);
}

module.exports = {
  criarEstrutura
};
