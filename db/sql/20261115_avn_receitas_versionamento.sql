-- Histórico imutável de versões de receitas; execuções idempotentes.
CREATE TABLE IF NOT EXISTS public.avn_receita_versoes (
 id BIGSERIAL PRIMARY KEY,
 receita_id BIGINT NOT NULL REFERENCES public.avn_receitas(id) ON DELETE RESTRICT,
 numero INTEGER NOT NULL CHECK(numero>0),
 nome VARCHAR(180) NOT NULL,
 preparo VARCHAR(120),
 rendimento_g NUMERIC(12,3) NOT NULL CHECK(rendimento_g>0 AND rendimento_g<=100000),
 composicao_100g JSONB NOT NULL,
 ingredientes JSONB NOT NULL CHECK(jsonb_typeof(ingredientes)='array'),
 criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(receita_id,numero)
);
CREATE INDEX IF NOT EXISTS avn_receita_versoes_receita ON public.avn_receita_versoes(receita_id,numero DESC);
ALTER TABLE public.avn_diario_alimentar ADD COLUMN IF NOT EXISTS receita_versao_id BIGINT REFERENCES public.avn_receita_versoes(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS avn_diario_receita_versao ON public.avn_diario_alimentar(receita_versao_id) WHERE receita_versao_id IS NOT NULL;
-- A primeira versão documenta SOMENTE a receita atual. O passado não é presumido.
INSERT INTO public.avn_receita_versoes(receita_id,numero,nome,preparo,rendimento_g,composicao_100g,ingredientes)
SELECT r.id,1,r.nome,r.preparo,r.rendimento_g,
jsonb_build_object('kcal',a.kcal_100g,'proteinas_g',a.proteinas_g_100g,'carboidratos_g',a.carboidratos_g_100g,
'gorduras_g',a.gorduras_g_100g,'fibras_g',a.fibras_g_100g,'micros',a.micronutrientes_100g),
COALESCE((SELECT jsonb_agg(jsonb_build_object('alimento_id',ri.alimento_id,'nome_snapshot',ri.nome_snapshot,
'quantidade_g',ri.quantidade_g,'ordem',ri.ordem,'composicao_100g',ri.composicao_100g) ORDER BY ri.ordem,ri.id)
FROM public.avn_receita_ingredientes ri WHERE ri.receita_id=r.id),'[]'::jsonb)
FROM public.avn_receitas r JOIN public.avn_alimentos a ON a.id=r.alimento_id
WHERE NOT EXISTS(SELECT 1 FROM public.avn_receita_versoes v WHERE v.receita_id=r.id)
ON CONFLICT(receita_id,numero) DO NOTHING;
-- Novos lançamentos são vinculados à versão de nome e composição idênticos.
-- Uma cópia do Diário que informa a versão mantém seu ID; mudanças de alimento recalculam.
CREATE OR REPLACE FUNCTION public.avn_diario_vincular_versao_receita() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE encontrada BIGINT;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF NEW.alimento_id IS NOT DISTINCT FROM OLD.alimento_id
   AND NEW.alimento_nome IS NOT DISTINCT FROM OLD.alimento_nome
   AND NEW.composicao_100g IS NOT DISTINCT FROM OLD.composicao_100g THEN
   NEW.receita_versao_id:=OLD.receita_versao_id; RETURN NEW;
  END IF;
  IF NEW.receita_versao_id IS NOT DISTINCT FROM OLD.receita_versao_id THEN NEW.receita_versao_id:=NULL; END IF;
 END IF;
 IF NEW.receita_versao_id IS NOT NULL THEN
  SELECT v.id INTO encontrada FROM public.avn_receita_versoes v
  JOIN public.avn_receitas r ON r.id=v.receita_id
  WHERE v.id=NEW.receita_versao_id AND r.usuario_id=NEW.usuario_id
    AND r.alimento_id=NEW.alimento_id AND v.nome=NEW.alimento_nome
    AND v.composicao_100g=NEW.composicao_100g;
  IF encontrada IS NULL THEN RAISE EXCEPTION 'Versão incompatível com lançamento do diário'; END IF;
  RETURN NEW;
 END IF;
 SELECT v.id INTO encontrada FROM public.avn_receita_versoes v
 JOIN public.avn_receitas r ON r.id=v.receita_id
 WHERE r.usuario_id=NEW.usuario_id AND r.alimento_id=NEW.alimento_id
 AND v.nome=NEW.alimento_nome AND v.composicao_100g=NEW.composicao_100g
 ORDER BY v.numero DESC LIMIT 1;
 NEW.receita_versao_id:=encontrada;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS avn_diario_vincular_versao_receita ON public.avn_diario_alimentar;
CREATE TRIGGER avn_diario_vincular_versao_receita BEFORE INSERT OR UPDATE ON public.avn_diario_alimentar
FOR EACH ROW EXECUTE FUNCTION public.avn_diario_vincular_versao_receita();
CREATE OR REPLACE FUNCTION public.avn_bloquear_mutacao_versao_receita() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Versões de receitas são imutáveis'; END $$;
DROP TRIGGER IF EXISTS avn_bloquear_mutacao_versao_receita ON public.avn_receita_versoes;
CREATE TRIGGER avn_bloquear_mutacao_versao_receita BEFORE UPDATE OR DELETE ON public.avn_receita_versoes
FOR EACH ROW EXECUTE FUNCTION public.avn_bloquear_mutacao_versao_receita();
