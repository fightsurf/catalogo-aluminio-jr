-- AVN: carimbo de alteração do Diário Alimentar para sincronização offline.
-- Executado também de forma idempotente na inicialização das rotas mobile.
ALTER TABLE public.avn_diario_alimentar ADD COLUMN IF NOT EXISTS modificado_em TIMESTAMPTZ NOT NULL DEFAULT NOW();
CREATE OR REPLACE FUNCTION public.avn_diario_carimbar_modificacao()
RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.modificado_em=clock_timestamp(); RETURN NEW; END $$;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.avn_diario_alimentar'::regclass AND tgname='avn_diario_modificacao_mobile') THEN
  CREATE TRIGGER avn_diario_modificacao_mobile BEFORE UPDATE ON public.avn_diario_alimentar
  FOR EACH ROW EXECUTE FUNCTION public.avn_diario_carimbar_modificacao();
 END IF;
END $$;
