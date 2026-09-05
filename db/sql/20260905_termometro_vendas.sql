-- Termômetro de Vendas
-- A aplicação cria esta estrutura automaticamente. Este arquivo serve como referência/manual.

CREATE TABLE IF NOT EXISTS termometro_aparicoes (
  id BIGSERIAL PRIMARY KEY,
  produto_id BIGINT NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
  origem VARCHAR(32) NOT NULL,
  origem_chave VARCHAR(180) NOT NULL,
  origem_id BIGINT,
  quantidade INTEGER NOT NULL DEFAULT 1,
  publicado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  detalhes JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_termometro_aparicoes_quantidade CHECK (quantidade > 0),
  CONSTRAINT uq_termometro_aparicoes_origem UNIQUE (origem, origem_chave, produto_id)
);

CREATE INDEX IF NOT EXISTS idx_termometro_aparicoes_data
  ON termometro_aparicoes (publicado_em DESC);

CREATE INDEX IF NOT EXISTS idx_termometro_aparicoes_produto_data
  ON termometro_aparicoes (produto_id, publicado_em DESC);

CREATE INDEX IF NOT EXISTS idx_termometro_aparicoes_origem_data
  ON termometro_aparicoes (origem, publicado_em DESC);
