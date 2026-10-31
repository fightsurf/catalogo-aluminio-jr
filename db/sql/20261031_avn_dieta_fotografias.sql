-- Fotografias imutáveis da dieta, independentes da vida útil dos perfis.
ALTER TABLE public.avn_dieta_refeicao_perfis
 ADD COLUMN IF NOT EXISTS recuperado BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.avn_dieta_itens
 ADD COLUMN IF NOT EXISTS composicao_100g JSONB;
CREATE TABLE IF NOT EXISTS public.avn_dieta_fotografias (
 id BIGSERIAL PRIMARY KEY,
 usuario_id BIGINT NOT NULL REFERENCES public.avn_usuario(id) ON DELETE CASCADE,
 nome VARCHAR(100) NOT NULL,
 dados JSONB NOT NULL,
 criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 CONSTRAINT avn_dieta_fotografias_nome CHECK (length(btrim(nome))>0)
);
CREATE INDEX IF NOT EXISTS avn_dieta_fotografias_usuario_data
 ON public.avn_dieta_fotografias(usuario_id,criado_em DESC,id DESC);
