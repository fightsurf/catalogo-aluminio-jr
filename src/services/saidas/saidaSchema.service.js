const pool = require('../../../db/connection');

async function tabelaExiste(nomeTabela) {
  const result = await pool.query('SELECT to_regclass($1) AS tabela', [nomeTabela]);
  return Boolean(result.rows[0] && result.rows[0].tabela);
}

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

async function prepararTabelasAntigas() {
  const temLancamentosAntigos = await tabelaExiste('saidas');
  if (!temLancamentosAntigos) return;

  await pool.query(`
    ALTER TABLE saidas ADD COLUMN IF NOT EXISTS vencimento DATE;
    ALTER TABLE saidas ADD COLUMN IF NOT EXISTS lote_carne VARCHAR(80);
    ALTER TABLE saidas ADD COLUMN IF NOT EXISTS numero_parcela INTEGER;
    ALTER TABLE saidas ADD COLUMN IF NOT EXISTS total_parcelas INTEGER;
    ALTER TABLE saidas DROP COLUMN IF EXISTS descricao;
  `);
}

async function migrarDadosAntigos() {
  const temCategoriasAntigas = await tabelaExiste('saida_categorias');
  const temItensAntigos = await tabelaExiste('saida_itens');
  const temLancamentosAntigos = await tabelaExiste('saidas');

  if (temCategoriasAntigas) {
    await pool.query(`
      INSERT INTO despesa_categorias (id, nome, ativo, observacao, created_at, updated_at)
      SELECT id, nome, ativo, observacao, created_at, updated_at
      FROM saida_categorias
      ON CONFLICT (id) DO NOTHING;
    `);

    await pool.query(`
      SELECT setval(
        pg_get_serial_sequence('despesa_categorias', 'id'),
        COALESCE((SELECT MAX(id) FROM despesa_categorias), 1),
        (SELECT COUNT(*) > 0 FROM despesa_categorias)
      );
    `);
  }

  if (temItensAntigos && temCategoriasAntigas) {
    await pool.query(`
      INSERT INTO despesa_itens (id, nome, categoria_id, recorrente_mensal, ativo, observacao, created_at, updated_at)
      SELECT id, nome, categoria_id, recorrente_mensal, ativo, observacao, created_at, updated_at
      FROM saida_itens
      ON CONFLICT (id) DO NOTHING;
    `);

    await pool.query(`
      SELECT setval(
        pg_get_serial_sequence('despesa_itens', 'id'),
        COALESCE((SELECT MAX(id) FROM despesa_itens), 1),
        (SELECT COUNT(*) > 0 FROM despesa_itens)
      );
    `);
  }

  if (temLancamentosAntigos && temItensAntigos) {
    await pool.query(`
      INSERT INTO despesa_lancamentos
        (id, item_saida_id, competencia_mes, competencia_ano, vencimento, data_saida, valor, forma_pagamento, status, observacao, lote_carne, numero_parcela, total_parcelas, created_at, updated_at)
      SELECT
        id,
        item_saida_id,
        competencia_mes,
        competencia_ano,
        vencimento,
        data_saida,
        valor,
        forma_pagamento,
        status,
        observacao,
        lote_carne,
        numero_parcela,
        total_parcelas,
        created_at,
        updated_at
      FROM saidas
      ON CONFLICT (id) DO NOTHING;
    `);

    await pool.query(`
      SELECT setval(
        pg_get_serial_sequence('despesa_lancamentos', 'id'),
        COALESCE((SELECT MAX(id) FROM despesa_lancamentos), 1),
        (SELECT COUNT(*) > 0 FROM despesa_lancamentos)
      );
    `);
  }
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
  await criarTabelasDespesas();
  await prepararTabelasAntigas();
  await migrarDadosAntigos();
  await recalcularMediasExistentes();
}

module.exports = {
  criarEstrutura
};
