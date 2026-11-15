-- Sequência visual de alimentos e medicamentos separada por perfil da refeição.
ALTER TABLE public.avn_dieta_planos
 ADD COLUMN IF NOT EXISTS painel_ordem JSONB NOT NULL DEFAULT '{}'::jsonb;
