-- PostgreSQL no Render (NÃO executar no Firebird/FlameRobin).
-- O módulo também pode inicializar esta tabela automaticamente no primeiro acesso.
CREATE TABLE IF NOT EXISTS marketing_republicador_youtube (
  id UUID PRIMARY KEY,
  youtube_video_id VARCHAR(11) NOT NULL,
  titulo TEXT NOT NULL,
  modo VARCHAR(12) NOT NULL CHECK (modo IN ('teste','publicar')),
  estado VARCHAR(25) NOT NULL DEFAULT 'aguardando',
  etapa TEXT NOT NULL DEFAULT 'Na fila',
  canais JSONB NOT NULL DEFAULT '{}'::jsonb,
  partes JSONB NOT NULL DEFAULT '{}'::jsonb,
  arquivos JSONB NOT NULL DEFAULT '[]'::jsonb,
  erro TEXT,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  r2_apagar_em TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_marketing_republicador_youtube_criado ON marketing_republicador_youtube (criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_marketing_republicador_youtube_limpeza ON marketing_republicador_youtube (r2_apagar_em) WHERE r2_apagar_em IS NOT NULL;
