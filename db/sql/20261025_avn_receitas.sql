-- Receitas AVN: cálculo por ingredientes e rendimento final, sem alterar registros antigos.
CREATE TABLE IF NOT EXISTS public.avn_receitas (
 id BIGSERIAL PRIMARY KEY,
 usuario_id BIGINT NOT NULL REFERENCES public.avn_usuario(id) ON DELETE RESTRICT,
 alimento_id BIGINT NOT NULL UNIQUE REFERENCES public.avn_alimentos(id) ON DELETE RESTRICT,
 nome VARCHAR(180) NOT NULL,
 preparo VARCHAR(120),
 rendimento_g NUMERIC(12,3) NOT NULL CHECK(rendimento_g > 0 AND rendimento_g <= 100000),
 observacoes TEXT,
 criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS avn_receitas_usuario ON public.avn_receitas(usuario_id,nome);
CREATE TABLE IF NOT EXISTS public.avn_receita_ingredientes (
 id BIGSERIAL PRIMARY KEY,
 receita_id BIGINT NOT NULL REFERENCES public.avn_receitas(id) ON DELETE CASCADE,
 alimento_id BIGINT NOT NULL REFERENCES public.avn_alimentos(id) ON DELETE RESTRICT,
 quantidade_g NUMERIC(12,3) NOT NULL CHECK(quantidade_g>0 AND quantidade_g<=10000),
 ordem INTEGER NOT NULL DEFAULT 0,
 composicao_100g JSONB NOT NULL,
 nome_snapshot VARCHAR(180) NOT NULL
);
CREATE INDEX IF NOT EXISTS avn_receita_ingredientes_receita ON public.avn_receita_ingredientes(receita_id,ordem,id);
