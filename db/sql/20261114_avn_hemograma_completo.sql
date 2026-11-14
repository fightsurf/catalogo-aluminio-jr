-- AVN - catalogo complementar do hemograma completo (sem resultados pessoais).
-- Idempotente: preserva indicadores existentes, referencias e historico.
INSERT INTO public.avn_exames_catalogo (codigo,nome,aliases,grupo,unidade_padrao,tipo)
VALUES
 ('bastonetes','Bastonetes',ARRAY['neutrofilos bastonetes','bastonetes relativos'],'Hemograma · Série branca','%','indicador'),
 ('bastonetes_absoluto','Bastonetes absolutos',ARRAY['bastonetes abs','neutrofilos bastonetes absolutos'],'Hemograma · Série branca','/µL','indicador'),
 ('eosinofilos_absoluto','Eosinófilos absolutos',ARRAY['eosinofilos abs'],'Hemograma · Série branca','/µL','indicador'),
 ('basofilos_absoluto','Basófilos absolutos',ARRAY['basofilos abs'],'Hemograma · Série branca','/µL','indicador'),
 ('monocitos_absoluto','Monócitos absolutos',ARRAY['monocitos abs'],'Hemograma · Série branca','/µL','indicador'),
 ('linfocitos_reativos','Linfócitos reativos',ARRAY['linfocitos atipicos','linfócitos reativos relativos'],'Hemograma · Série branca','%','indicador'),
 ('linfocitos_reativos_absoluto','Linfócitos reativos absolutos',ARRAY['linfocitos reativos abs','linfocitos atipicos absolutos'],'Hemograma · Série branca','/µL','indicador'),
 ('morfologia_serie_vermelha','Morfologia da série vermelha',ARRAY['observacao serie vermelha','observações do eritrograma'],'Hemograma · Série vermelha','texto','indicador'),
 ('morfologia_serie_branca','Morfologia da série branca',ARRAY['observacao serie branca','observações do leucograma'],'Hemograma · Série branca','texto','indicador'),
 ('morfologia_serie_plaquetaria','Morfologia da série plaquetária',ARRAY['observacao plaquetas','observações da série plaquetária'],'Hemograma · Plaquetas','texto','indicador')
ON CONFLICT (codigo) DO NOTHING;

-- Alias complementares para laudos que usam siglas e nomes alternativos.
WITH novos(codigo,alias) AS (VALUES
 ('hemacias','hemacias (rbc)'),
 ('vcm','v.c.m.'),
 ('hcm','h.c.m.'),
 ('chcm','c.h.c.m.'),
 ('rdw','r.d.w.'),
 ('neutrofilos','segmentados relativos'),
 ('neutrofilos_absoluto','segmentados absolutos'),
 ('neutrofilos_absoluto','segmentados abs'),
 ('linfocitos_absoluto','linfócitos absolutos')
)
UPDATE public.avn_exames_catalogo AS c
SET aliases=array_append(c.aliases,novos.alias)
FROM novos WHERE c.codigo=novos.codigo AND NOT (novos.alias=ANY(c.aliases));
