-- AVN · Hemoglobina glicada: frações cromatográficas e glicemia média estimada.
-- Complementa o indicador hba1c (já cadastrado em 20261027), sem duplicá-lo.
-- Apenas prepara o catálogo; dados pessoais dos laudos não são inseridos por migração.
-- Migração idempotente, executada pela inicialização do AVN.
INSERT INTO public.avn_exames_catalogo(codigo,nome,aliases,grupo,unidade_padrao,tipo)
VALUES
 ('hba1a','HbA1a',ARRAY['hba1a','hemoglobina a1a','fração hba1a','fracao hba1a'],'Metabolismo','%','indicador'),
 ('hba1b','HbA1b',ARRAY['hba1b','hemoglobina a1b','fração hba1b','fracao hba1b'],'Metabolismo','%','indicador'),
 ('hbf','HbF',ARRAY['hbf','hemoglobina fetal','hemoglobina f'],'Metabolismo','%','indicador'),
 ('hba1c_labil','HbA1c lábil',ARRAY['hba1c lábil','hba1c labil','hba1c labile','hemoglobina glicada lábil'],'Metabolismo','%','indicador'),
 ('hba','HbA',ARRAY['hba','hemoglobina a','hemoglobina a total'],'Metabolismo','%','indicador'),
 ('glicemia_media_estimada','Glicemia média estimada',ARRAY['glicemia estimada média','glicemia media estimada','glicose média estimada','glicose media estimada','eag','estimated average glucose'],'Metabolismo','mg/dL','indicador')
ON CONFLICT (codigo) DO NOTHING;
