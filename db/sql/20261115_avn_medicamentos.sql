-- Amplia a categoria do cadastro nutricional sem alterar registros existentes.
-- Idempotente: somente troca a restrição se ela ainda não admitir medicamentos.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='avn_alimentos_tipo_check'
      AND conrelid='public.avn_alimentos'::regclass
      AND pg_get_constraintdef(oid) NOT LIKE '%medicamento%'
  ) THEN
    ALTER TABLE public.avn_alimentos DROP CONSTRAINT avn_alimentos_tipo_check;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='avn_alimentos_tipo_check'
      AND conrelid='public.avn_alimentos'::regclass
  ) THEN
    ALTER TABLE public.avn_alimentos
      ADD CONSTRAINT avn_alimentos_tipo_check
      CHECK (tipo IN ('alimento', 'suplemento', 'medicamento', 'receita'));
  END IF;
END $$;
