-- Resumo de produção semanal: vínculo permanente produto → fornecedor.
-- Todos os dados residem no MESMO PostgreSQL. Seguro para reexecução.
ALTER TABLE public.produtos ADD COLUMN IF NOT EXISTS fornecedor_id INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'produtos_fornecedor_id_fkey'
      AND conrelid = 'public.produtos'::regclass
  ) THEN
    ALTER TABLE public.produtos ADD CONSTRAINT produtos_fornecedor_id_fkey
      FOREIGN KEY (fornecedor_id) REFERENCES public.fornecedores(id)
      ON UPDATE CASCADE ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_produtos_fornecedor_id ON public.produtos(fornecedor_id);

-- Registro de tentativa para não reenviar inadvertidamente durante erro/timeout.
CREATE TABLE IF NOT EXISTS public.semanas_fornecedores_envios (
  id BIGSERIAL PRIMARY KEY,
  semana_id INTEGER NOT NULL REFERENCES public.semanas(id) ON DELETE CASCADE,
  fornecedor_id INTEGER NOT NULL REFERENCES public.fornecedores(id) ON DELETE CASCADE,
  conteudo_hash VARCHAR(64) NOT NULL,
  telefone VARCHAR(32) NOT NULL,
  mensagem TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'enviando',
  retorno_zapi JSONB,
  erro TEXT,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT semanas_fornecedores_envios_status_ck
    CHECK (status IN ('enviando','aceito','incerto')),
  CONSTRAINT semanas_fornecedores_envios_hash_uk
    UNIQUE (semana_id, fornecedor_id, conteudo_hash)
);
CREATE INDEX IF NOT EXISTS idx_semanas_fornecedores_envios_consulta
  ON public.semanas_fornecedores_envios(semana_id, fornecedor_id, criado_em DESC);
