-- Seleção global e ordem dos produtos acompanhados no Termômetro de Vendas.
-- Também criada automaticamente na primeira abertura do módulo.
CREATE TABLE IF NOT EXISTS termometro_produtos_monitorados (
  produto_id BIGINT PRIMARY KEY REFERENCES produtos(id) ON DELETE CASCADE,
  ordem INTEGER NOT NULL DEFAULT 0,
  cadastrado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
