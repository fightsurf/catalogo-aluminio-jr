-- AVN · Perfil cardiovascular. Aditivo, idempotente, sem presumir "não" para campos ignorados.
CREATE TABLE IF NOT EXISTS public.avn_risco_cardiovascular_perfil (
 usuario_id BIGINT PRIMARY KEY REFERENCES public.avn_usuario(id) ON DELETE CASCADE,
 pressao_sistolica SMALLINT CHECK (pressao_sistolica BETWEEN 70 AND 260),
 pressao_diastolica SMALLINT CHECK (pressao_diastolica BETWEEN 35 AND 160),
 usa_antihipertensivo VARCHAR(15) NOT NULL DEFAULT 'nao_informado',
 usa_estatina VARCHAR(15) NOT NULL DEFAULT 'nao_informado',
 fuma VARCHAR(15) NOT NULL DEFAULT 'nao_informado',
 diabetes_diagnosticado VARCHAR(15) NOT NULL DEFAULT 'nao_informado',
 historico_familiar_precoce VARCHAR(15) NOT NULL DEFAULT 'nao_informado',
 evento_cardiovascular_previo VARCHAR(15) NOT NULL DEFAULT 'nao_informado',
 obstrucao_arterial_50 VARCHAR(15) NOT NULL DEFAULT 'nao_informado',
 placa_subclinica VARCHAR(15) NOT NULL DEFAULT 'nao_informado',
 escore_calcio_coronariano NUMERIC(8,1) CHECK (escore_calcio_coronariano BETWEEN 0 AND 100000),
 atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 CONSTRAINT avn_risco_cv_tri CHECK (
  usa_antihipertensivo IN ('sim','nao','nao_informado')
  AND usa_estatina IN ('sim','nao','nao_informado')
  AND fuma IN ('sim','nao','nao_informado')
  AND diabetes_diagnosticado IN ('sim','nao','nao_informado')
  AND historico_familiar_precoce IN ('sim','nao','nao_informado')
  AND evento_cardiovascular_previo IN ('sim','nao','nao_informado')
  AND obstrucao_arterial_50 IN ('sim','nao','nao_informado')
  AND placa_subclinica IN ('sim','nao','nao_informado')
 )
);
