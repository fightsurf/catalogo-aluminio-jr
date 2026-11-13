-- Classifica alimentos, suplementos e receitas no mesmo catálogo nutricional.
-- Os registros anteriores são migrados uma única vez para manter a distinção
-- entre receitas já existentes e os alimentos que formavam o catálogo original.
ALTER TABLE public.avn_alimentos
  ADD COLUMN IF NOT EXISTS tipo VARCHAR(20);

UPDATE public.avn_alimentos
SET tipo = CASE WHEN fonte = 'receita' THEN 'receita' ELSE 'alimento' END
WHERE tipo IS NULL OR tipo = '';

ALTER TABLE public.avn_alimentos
  ALTER COLUMN tipo SET DEFAULT 'alimento',
  ALTER COLUMN tipo SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'avn_alimentos_tipo_check'
      AND conrelid = 'public.avn_alimentos'::regclass
  ) THEN
    ALTER TABLE public.avn_alimentos
      ADD CONSTRAINT avn_alimentos_tipo_check
      CHECK (tipo IN ('alimento', 'suplemento', 'receita'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS avn_alimentos_tipo_usuario_nome
  ON public.avn_alimentos(tipo, usuario_id, LOWER(nome));
