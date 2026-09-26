CREATE TABLE IF NOT EXISTS sistema_aplicativos_config (
  rota TEXT PRIMARY KEY,
  nome VARCHAR(160),
  categoria VARCHAR(100),
  visibilidade VARCHAR(20) NOT NULL DEFAULT 'principal',
  favorito BOOLEAN NOT NULL DEFAULT FALSE,
  ordem INTEGER,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sistema_apps_categoria ON sistema_aplicativos_config(categoria);
