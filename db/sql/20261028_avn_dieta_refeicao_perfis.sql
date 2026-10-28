-- Perfis independentes por refeição. Preserva todos os itens existentes no perfil Original.
CREATE TABLE IF NOT EXISTS public.avn_dieta_refeicao_perfis (
 id BIGSERIAL PRIMARY KEY,
 plano_id BIGINT NOT NULL REFERENCES public.avn_dieta_planos(id) ON DELETE CASCADE,
 refeicao VARCHAR(30) NOT NULL,
 nome VARCHAR(80) NOT NULL,
 ativo BOOLEAN NOT NULL DEFAULT FALSE,
 criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 CONSTRAINT avn_dieta_perfil_nome CHECK (length(btrim(nome)) > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS avn_dieta_perfil_nome_unico
 ON public.avn_dieta_refeicao_perfis(plano_id,refeicao,LOWER(nome));
CREATE UNIQUE INDEX IF NOT EXISTS avn_dieta_perfil_ativo_unico
 ON public.avn_dieta_refeicao_perfis(plano_id,refeicao) WHERE ativo;
ALTER TABLE public.avn_dieta_itens
 ADD COLUMN IF NOT EXISTS perfil_id BIGINT REFERENCES public.avn_dieta_refeicao_perfis(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS avn_dieta_itens_perfil
 ON public.avn_dieta_itens(perfil_id,ordem,id);
INSERT INTO public.avn_dieta_refeicao_perfis(plano_id,refeicao,nome,ativo)
 SELECT DISTINCT i.plano_id,i.refeicao,'Original',TRUE FROM public.avn_dieta_itens i
 WHERE NOT EXISTS (SELECT 1 FROM public.avn_dieta_refeicao_perfis p WHERE p.plano_id=i.plano_id AND p.refeicao=i.refeicao)
 ON CONFLICT DO NOTHING;
UPDATE public.avn_dieta_itens i SET perfil_id=p.id
 FROM public.avn_dieta_refeicao_perfis p
 WHERE i.perfil_id IS NULL AND p.plano_id=i.plano_id
 AND p.refeicao=i.refeicao AND p.ativo;
