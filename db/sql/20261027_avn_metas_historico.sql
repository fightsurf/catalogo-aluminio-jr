-- Histórico permanente de definições de metas do AVN (idempotente).
CREATE TABLE IF NOT EXISTS public.avn_metas_nutricionais_historico (
 id BIGSERIAL PRIMARY KEY,
 usuario_id BIGINT NOT NULL REFERENCES public.avn_usuario(id) ON DELETE RESTRICT,
 kcal NUMERIC(12,2),
 proteinas_g NUMERIC(12,2),
 carboidratos_g NUMERIC(12,2),
 gorduras_g NUMERIC(12,2),
 fibras_g NUMERIC(12,2),
 micros JSONB NOT NULL DEFAULT '{}'::jsonb,
 peso_kg NUMERIC(10,3),
 proteinas_g_kg NUMERIC(12,4),
 carboidratos_g_kg NUMERIC(12,4),
 gorduras_g_kg NUMERIC(12,4),
 energia_macros_kcal NUMERIC(12,2),
 origem VARCHAR(32) NOT NULL DEFAULT 'manual',
 criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 CONSTRAINT avn_metas_hist_origem_chk CHECK (origem IN ('manual','calculadora_gkg','ia','restauracao','legado')),
 CONSTRAINT avn_metas_hist_peso_chk CHECK (peso_kg IS NULL OR peso_kg BETWEEN 1 AND 500)
);
CREATE INDEX IF NOT EXISTS avn_metas_hist_usuario_data
 ON public.avn_metas_nutricionais_historico(usuario_id,criado_em DESC,id DESC);

-- Conserva a definição que já existia antes da adoção do histórico, sem duplicar em reinicializações.
INSERT INTO public.avn_metas_nutricionais_historico
 (usuario_id,kcal,proteinas_g,carboidratos_g,gorduras_g,fibras_g,micros,
  energia_macros_kcal,origem,criado_em)
SELECT m.usuario_id,m.kcal,m.proteinas_g,m.carboidratos_g,m.gorduras_g,m.fibras_g,m.micros,
 CASE WHEN m.proteinas_g IS NOT NULL AND m.carboidratos_g IS NOT NULL AND m.gorduras_g IS NOT NULL
 THEN ROUND(m.proteinas_g*4 + m.carboidratos_g*4 + m.gorduras_g*9,2) ELSE NULL END,
 'legado',m.atualizado_em
FROM public.avn_metas_nutricionais m
WHERE NOT EXISTS (SELECT 1 FROM public.avn_metas_nutricionais_historico h WHERE h.usuario_id=m.usuario_id);
