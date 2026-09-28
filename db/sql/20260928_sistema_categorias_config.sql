CREATE TABLE IF NOT EXISTS sistema_categorias_config (
  nome VARCHAR(100) PRIMARY KEY,
  icone VARCHAR(80),
  ordem INTEGER,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sistema_categorias_ordem ON sistema_categorias_config(ordem);
