ALTER TABLE produtos
  ADD COLUMN IF NOT EXISTS perfil_kit_feirinha BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS perfil_orcamento BOOLEAN DEFAULT TRUE;

UPDATE produtos
SET perfil_kit_feirinha = COALESCE(perfil_kit_feirinha, TRUE),
    perfil_orcamento = COALESCE(perfil_orcamento, TRUE)
WHERE perfil_kit_feirinha IS NULL
   OR perfil_orcamento IS NULL;

ALTER TABLE produtos
  ALTER COLUMN perfil_kit_feirinha SET DEFAULT TRUE,
  ALTER COLUMN perfil_kit_feirinha SET NOT NULL,
  ALTER COLUMN perfil_orcamento SET DEFAULT TRUE,
  ALTER COLUMN perfil_orcamento SET NOT NULL;
