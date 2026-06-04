-- Patch do módulo de despesas: novas tabelas internas e médias anuais.
-- O sistema executa a criação/migração automaticamente via src/services/saidas/saidaSchema.service.js.
-- Este arquivo fica como registro/manual de apoio.

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
