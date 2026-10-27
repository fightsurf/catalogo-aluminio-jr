-- Água ingerida, separada da água corporal por bioimpedância.
CREATE TABLE IF NOT EXISTS public.avn_agua_registros(
 id UUID PRIMARY KEY,
 usuario_id BIGINT NOT NULL REFERENCES public.avn_usuario(id) ON DELETE RESTRICT,
 quantidade_ml INTEGER NOT NULL CHECK(quantidade_ml BETWEEN 1 AND 10000),
 ingerido_em TIMESTAMPTZ NOT NULL,
 removido_em TIMESTAMPTZ,
 criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS avn_agua_registros_usuario_data ON public.avn_agua_registros(usuario_id,ingerido_em DESC) WHERE removido_em IS NULL;
