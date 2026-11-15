-- Medicamentos programados em separado de alimentos e cálculos nutricionais.
CREATE TABLE IF NOT EXISTS public.avn_dieta_medicamentos (
 id BIGSERIAL PRIMARY KEY,
 plano_id BIGINT NOT NULL REFERENCES public.avn_dieta_planos(id) ON DELETE CASCADE,
 medicamento_id BIGINT NOT NULL REFERENCES public.avn_alimentos(id) ON DELETE RESTRICT,
 refeicao VARCHAR(30) NOT NULL CHECK (refeicao IN ('cafe','lanche_manha','almoco','lanche_tarde','jantar','ceia','outros')),
 dose_texto VARCHAR(120),
 horario VARCHAR(60),
 criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS avn_dieta_medicamentos_plano_refeicao
 ON public.avn_dieta_medicamentos(plano_id,refeicao,id);
