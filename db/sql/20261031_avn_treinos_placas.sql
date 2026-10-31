-- AVN: placas e quilogramas são unidades independentes.
DO $$
DECLARE t TEXT;
BEGIN
 FOREACH t IN ARRAY ARRAY['avn_plano_itens','avn_treino_sessao_itens','avn_treino_execucao_eventos']
 LOOP
  EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS carga_unidade VARCHAR(6) NOT NULL DEFAULT ''kg'' CHECK (carga_unidade IN (''kg'',''placas''))',t);
  EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS carga_placas SMALLINT CHECK (carga_placas BETWEEN 0 AND 200)',t);
 END LOOP;
END $$;
