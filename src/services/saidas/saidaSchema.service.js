const pool = require('../../../db/connection');

async function criarTabelasDespesas() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS despesa_categorias (
      id SERIAL PRIMARY KEY,
      nome VARCHAR(160) NOT NULL,
      ativo BOOLEAN NOT NULL DEFAULT TRUE,
      observacao TEXT,
      created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
    );

    CREATE UNIQUE INDEX IF NOT EXISTS ux_despesa_categorias_nome_lower
      ON despesa_categorias (LOWER(TRIM(nome)));

    CREATE TABLE IF NOT EXISTS despesa_itens (
      id SERIAL PRIMARY KEY,
      nome VARCHAR(180) NOT NULL,
      categoria_id INTEGER NOT NULL REFERENCES despesa_categorias(id),
      recorrente_mensal BOOLEAN NOT NULL DEFAULT TRUE,
      ativo BOOLEAN NOT NULL DEFAULT TRUE,
      observacao TEXT,
      created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
    );

    CREATE UNIQUE INDEX IF NOT EXISTS ux_despesa_itens_nome_lower
      ON despesa_itens (LOWER(TRIM(nome)));

    CREATE INDEX IF NOT EXISTS ix_despesa_itens_categoria_id
      ON despesa_itens (categoria_id);

    ALTER TABLE despesa_itens
      ADD COLUMN IF NOT EXISTS classificacao VARCHAR(30) NOT NULL DEFAULT 'DESPESA';

    ALTER TABLE despesa_itens
      ADD COLUMN IF NOT EXISTS forma_calculo VARCHAR(30) NOT NULL DEFAULT 'VALOR_MENSAL';

    ALTER TABLE despesa_itens
      ADD COLUMN IF NOT EXISTS valor_mensal NUMERIC(14,2) NOT NULL DEFAULT 0;

    ALTER TABLE despesa_itens
      ADD COLUMN IF NOT EXISTS origem_valor VARCHAR(30) NOT NULL DEFAULT 'MANUAL';

    CREATE INDEX IF NOT EXISTS ix_despesa_itens_classificacao
      ON despesa_itens (classificacao);

    CREATE TABLE IF NOT EXISTS despesa_lancamentos (
      id SERIAL PRIMARY KEY,
      item_saida_id INTEGER NOT NULL REFERENCES despesa_itens(id),
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

    ALTER TABLE despesa_lancamentos
      ADD COLUMN IF NOT EXISTS vencimento DATE;

    ALTER TABLE despesa_lancamentos
      ADD COLUMN IF NOT EXISTS lote_carne VARCHAR(80);

    ALTER TABLE despesa_lancamentos
      ADD COLUMN IF NOT EXISTS numero_parcela INTEGER;

    ALTER TABLE despesa_lancamentos
      ADD COLUMN IF NOT EXISTS total_parcelas INTEGER;

    ALTER TABLE despesa_lancamentos
      DROP COLUMN IF EXISTS descricao;

    CREATE INDEX IF NOT EXISTS ix_despesa_lancamentos_competencia
      ON despesa_lancamentos (competencia_ano, competencia_mes);

    CREATE INDEX IF NOT EXISTS ix_despesa_lancamentos_item_saida_id
      ON despesa_lancamentos (item_saida_id);

    CREATE INDEX IF NOT EXISTS ix_despesa_lancamentos_status
      ON despesa_lancamentos (status);

    CREATE INDEX IF NOT EXISTS ix_despesa_lancamentos_vencimento
      ON despesa_lancamentos (vencimento);

    CREATE INDEX IF NOT EXISTS ix_despesa_lancamentos_lote_carne
      ON despesa_lancamentos (lote_carne);

    CREATE TABLE IF NOT EXISTS despesa_item_medias_anuais (
      id SERIAL PRIMARY KEY,
      item_saida_id INTEGER NOT NULL REFERENCES despesa_itens(id) ON DELETE CASCADE,
      ano INTEGER NOT NULL CHECK (ano BETWEEN 2000 AND 2100),
      valor_total NUMERIC(14,2) NOT NULL DEFAULT 0,
      qtd_meses_considerados INTEGER NOT NULL DEFAULT 0,
      valor_medio NUMERIC(14,2) NOT NULL DEFAULT 0,
      atualizado_em TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
      UNIQUE (item_saida_id, ano)
    );

    CREATE INDEX IF NOT EXISTS ix_despesa_item_medias_ano
      ON despesa_item_medias_anuais (ano);
  `);
}

async function recalcularMediasExistentes() {
  await pool.query(`
    INSERT INTO despesa_item_medias_anuais
      (item_saida_id, ano, valor_total, qtd_meses_considerados, valor_medio, atualizado_em)
    SELECT
      d.item_saida_id,
      d.competencia_ano AS ano,
      SUM(d.valor)::numeric(14,2) AS valor_total,
      COUNT(DISTINCT d.competencia_mes)::int AS qtd_meses_considerados,
      ROUND((SUM(d.valor) / NULLIF(COUNT(DISTINCT d.competencia_mes), 0))::numeric, 2)::numeric(14,2) AS valor_medio,
      NOW() AS atualizado_em
    FROM despesa_lancamentos d
    WHERE d.status IN ('PAGO', 'PENDENTE')
    GROUP BY d.item_saida_id, d.competencia_ano
    ON CONFLICT (item_saida_id, ano) DO UPDATE SET
      valor_total = EXCLUDED.valor_total,
      qtd_meses_considerados = EXCLUDED.qtd_meses_considerados,
      valor_medio = EXCLUDED.valor_medio,
      atualizado_em = NOW();
  `);
}

async function criarEstrutura() {
  // Importacao das tabelas antigas desativada permanentemente.
  // Reexecuta-la no deploy recriava itens e categorias excluidos pelo usuario.
  await criarTabelasDespesas();
  await recalcularMediasExistentes();
}

module.exports = {
  criarEstrutura
};
