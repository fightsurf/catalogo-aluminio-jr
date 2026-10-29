-- AVN 2026-10-29: dificuldade subjetiva da serie (separada de RIR).
-- Migracao idempotente; o backend tambem a aplica automaticamente ao iniciar.
ALTER TABLE IF EXISTS public.avn_treino_execucao_eventos
  ADD COLUMN IF NOT EXISTS dificuldade VARCHAR(10)
  CHECK (dificuldade IN ('facil','moderado','dificil'));

-- Nao altera nem interpreta registros antigos com RIR.
