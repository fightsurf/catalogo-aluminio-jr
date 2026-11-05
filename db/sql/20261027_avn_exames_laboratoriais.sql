-- AVN · Saúde / Exames Laboratoriais. Migração aditiva e idempotente.
-- Valores de referência são específicos de laboratório/método/perfil: nunca presumir um intervalo universal.
CREATE TABLE IF NOT EXISTS public.avn_exames_catalogo (
 id BIGSERIAL PRIMARY KEY,
 codigo VARCHAR(90) NOT NULL UNIQUE,
 nome VARCHAR(180) NOT NULL,
 aliases TEXT[] NOT NULL DEFAULT '{}',
 grupo VARCHAR(120) NOT NULL DEFAULT 'Outros',
 unidade_padrao VARCHAR(45),
 tipo VARCHAR(15) NOT NULL DEFAULT 'indicador' CHECK (tipo IN ('indicador','painel')),
 ativo BOOLEAN NOT NULL DEFAULT TRUE,
 criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_avn_exames_catalogo_grupo ON public.avn_exames_catalogo(grupo,nome);
CREATE TABLE IF NOT EXISTS public.avn_exames_referencias (
 id BIGSERIAL PRIMARY KEY,
 exame_id BIGINT NOT NULL REFERENCES public.avn_exames_catalogo(id) ON DELETE RESTRICT,
 laboratorio VARCHAR(180),
 material VARCHAR(120),
 metodo VARCHAR(180),
 sexo_referencia VARCHAR(30),
 idade_min_anos SMALLINT,
 idade_max_anos SMALLINT,
 limite_inferior NUMERIC,
 limite_superior NUMERIC,
 referencia_texto TEXT,
 unidade VARCHAR(45) NOT NULL,
 fonte VARCHAR(300),
 criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 CHECK (limite_inferior IS NULL OR limite_superior IS NULL OR limite_inferior <= limite_superior)
);
CREATE INDEX IF NOT EXISTS idx_avn_exames_referencias_exame ON public.avn_exames_referencias(exame_id);
CREATE TABLE IF NOT EXISTS public.avn_exames_resultados (
 id BIGSERIAL PRIMARY KEY,
 usuario_id BIGINT NOT NULL REFERENCES public.avn_usuario(id) ON DELETE RESTRICT,
 exame_id BIGINT NOT NULL REFERENCES public.avn_exames_catalogo(id) ON DELETE RESTRICT,
 data_coleta DATE NOT NULL,
 valor NUMERIC,
 valor_texto VARCHAR(250),
 unidade VARCHAR(45) NOT NULL,
 limite_inferior NUMERIC,
 limite_superior NUMERIC,
 referencia_texto TEXT,
 material VARCHAR(120),
 metodo VARCHAR(180),
 laboratorio VARCHAR(180),
 lote_importacao VARCHAR(60),
 origem VARCHAR(20) NOT NULL DEFAULT 'manual' CHECK (origem IN ('manual','ia')),
 observacoes TEXT,
 criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 CHECK (valor IS NOT NULL OR NULLIF(BTRIM(valor_texto),'') IS NOT NULL),
 CHECK (limite_inferior IS NULL OR limite_superior IS NULL OR limite_inferior <= limite_superior)
);
CREATE INDEX IF NOT EXISTS idx_avn_exames_resultados_usuario_data ON public.avn_exames_resultados(usuario_id,data_coleta DESC,id DESC);
CREATE INDEX IF NOT EXISTS idx_avn_exames_resultados_evolucao ON public.avn_exames_resultados(usuario_id,exame_id,data_coleta,id);
-- Sem intervalos numéricos genéricos: referências são confirmadas contra laudos e armazenadas por resultado.
INSERT INTO public.avn_exames_catalogo(codigo,nome,aliases,grupo,unidade_padrao,tipo)
VALUES
('hemograma','Hemograma completo',ARRAY['hemograma'], 'Hemograma',NULL,'painel'),
('hemacias','Hemácias',ARRAY['eritrócitos','rbc'],'Hemograma · Série vermelha','milhões/µL','indicador'),
('hemoglobina','Hemoglobina',ARRAY['hb'],'Hemograma · Série vermelha','g/dL','indicador'),
('hematocrito','Hematócrito',ARRAY['ht','hct'],'Hemograma · Série vermelha','%','indicador'),
('vcm','VCM',ARRAY['volume corpuscular médio'],'Hemograma · Série vermelha','fL','indicador'),
('hcm','HCM',ARRAY['hemoglobina corpuscular média'],'Hemograma · Série vermelha','pg','indicador'),
('chcm','CHCM',ARRAY['concentração de hemoglobina corpuscular média'],'Hemograma · Série vermelha','g/dL','indicador'),
('rdw','RDW',ARRAY['amplitude de distribuição eritrocitária'],'Hemograma · Série vermelha','%','indicador'),
('leucocitos','Leucócitos',ARRAY['wbc','leucócitos totais'],'Hemograma · Série branca','/µL','indicador'),
('neutrofilos','Neutrófilos',ARRAY['segmentados'],'Hemograma · Série branca','%','indicador'),
('neutrofilos_absoluto','Neutrófilos absolutos',ARRAY['neutrófilos abs'],'Hemograma · Série branca','/µL','indicador'),
('linfocitos','Linfócitos',ARRAY['linfócitos relativos'],'Hemograma · Série branca','%','indicador'),
('linfocitos_absoluto','Linfócitos absolutos',ARRAY['linfócitos abs'],'Hemograma · Série branca','/µL','indicador'),
('monocitos','Monócitos',ARRAY[]::text[],'Hemograma · Série branca','%','indicador'),
('eosinofilos','Eosinófilos',ARRAY[]::text[],'Hemograma · Série branca','%','indicador'),
('basofilos','Basófilos',ARRAY[]::text[],'Hemograma · Série branca','%','indicador'),
('plaquetas','Plaquetas',ARRAY['contagem de plaquetas'],'Hemograma · Plaquetas','/µL','indicador'),
('vpm','VPM',ARRAY['volume plaquetário médio','mpv'],'Hemograma · Plaquetas','fL','indicador'),
('ureia','Ureia',ARRAY['uréia'],'Função renal','mg/dL','indicador'),
('creatinina','Creatinina',ARRAY[]::text[],'Função renal','mg/dL','indicador'),
('tfg_estimada','TFG estimada (eTFG)',ARRAY['tfg','egfr','tfge','taxa de filtração glomerular','taxa de filtração glomerular estimada','filtração glomerular estimada','ckd-epi'],'Função renal','mL/min/1,73 m²','indicador'),
('tgo','Aspartato aminotransferase (TGO/AST)',ARRAY['tgo','ast','aspartato aminotransferase'],'Função hepática','U/L','indicador'),
('tgp','Alanina aminotransferase (TGP/ALT)',ARRAY['tgp','alt','alanina aminotransferase'],'Função hepática','U/L','indicador'),
('gama_gt','Gama GT',ARRAY['ggt','gama glutamiltransferase'],'Função hepática','U/L','indicador'),
('glicemia_jejum','Glicemia de jejum',ARRAY['glicose de jejum','glicemia'],'Metabolismo','mg/dL','indicador'),
('glicose','Glicose',ARRAY['glucose','glicose sérica','glicose serica','glicose no sangue'],'Metabolismo','mg/dL','indicador'),
('hba1c','Hemoglobina glicada',ARRAY['hba1c','a1c'],'Metabolismo','%','indicador'),
('colesterol_total','Colesterol total',ARRAY[]::text[],'Perfil lipídico','mg/dL','indicador'),
('hdl','Colesterol HDL',ARRAY['hdl'],'Perfil lipídico','mg/dL','indicador'),
('ldl','Colesterol LDL',ARRAY['ldl'],'Perfil lipídico','mg/dL','indicador'),
('colesterol_nao_hdl','Colesterol não-HDL',ARRAY['colesterol nao hdl','colesterol não hdl','não hdl','nao hdl','colesterol non hdl','non-hdl cholesterol'],'Perfil lipídico','mg/dL','indicador'),
('vldl','Colesterol VLDL',ARRAY['vldl','vldl-c','colesterol vldl','very low density lipoprotein cholesterol'],'Perfil lipídico','mg/dL','indicador'),
('triglicerideos','Triglicerídeos',ARRAY['tg'],'Perfil lipídico','mg/dL','indicador'),
('tsh','TSH',ARRAY['hormônio tireoestimulante'],'Tireoide','µUI/mL','indicador'),
('t4_livre','T4 livre',ARRAY['ft4','tiroxina livre'],'Tireoide','ng/dL','indicador'),
('t3_livre','T3 livre',ARRAY['ft3'],'Tireoide','pg/mL','indicador'),
('testosterona_total','Testosterona total',ARRAY[]::text[],'Hormônios','ng/dL','indicador'),
('testosterona_livre','Testosterona livre',ARRAY[]::text[],'Hormônios','ng/dL','indicador'),
('shbg','SHBG',ARRAY['globulina ligadora dos hormônios sexuais','globulina ligadora de hormônios sexuais','globulina ligadora de hormônios sexuais - shbg'],'Hormônios','nmol/L','indicador'),
('fsh','FSH',ARRAY['hormônio folículo estimulante','hormônio folículo-estimulante','hormônio folículo estimulante - fsh','hormônio foliculoestimulante','folitropina','follicle stimulating hormone'],'Hormônios','mUI/mL','indicador'),
('lh','LH',ARRAY['hormônio luteinizante','hormônio luteinizante - lh','lutropina','luteinizing hormone'],'Hormônios','mUI/mL','indicador'),
('estradiol','Estradiol',ARRAY['e2','17-beta estradiol','17β-estradiol'],'Hormônios','pg/mL','indicador'),
('vitamina_d','Vitamina D (25-OH)',ARRAY['25-oh vitamina d','25 hidroxi vitamina d'],'Vitaminas','ng/mL','indicador'),
('vitamina_b12','Vitamina B12',ARRAY['cobalamina'],'Vitaminas','pg/mL','indicador'),
('insulina_basal','Insulina basal',ARRAY['insulina','insulina em jejum','insulina de jejum','insulina sérica','insulina serica','fasting insulin'],'Hormônios','µUI/mL','indicador'),
('magnesio','Magnésio',ARRAY['magnesio','magnésio sérico','magnesio serico','magnésio no sangue'],'Minerais','mg/dL','indicador'),
('fosforo','Fósforo',ARRAY['fosforo','fósforo sérico','fosforo serico','fósforo inorgânico','fosforo inorganico','fosfato sérico','phosphorus'],'Minerais','mg/dL','indicador'),
('calcio_total','Cálcio total',ARRAY['cálcio','calcio','cálcio sérico','calcio serico','calcio total','cálcio no sangue','calcio no sangue','total calcium'],'Minerais','mg/dL','indicador'),
('acido_urico','Ácido úrico',ARRAY['acido urico','ácido úrico sérico','acido urico serico','uricemia','urato sérico','urato serico','uric acid','serum uric acid'],'Metabolismo','mg/dL','indicador'),
('ferritina','Ferritina',ARRAY[]::text[],'Metabolismo','ng/mL','indicador'),
('pcr','Proteína C-reativa',ARRAY['pcr','crp'],'Inflamação','mg/L','indicador')
ON CONFLICT(codigo) DO NOTHING;
-- Atualiza aliases do SHBG já existente sem substituir outras equivalências.
UPDATE public.avn_exames_catalogo
SET aliases = array_append(aliases,'globulina ligadora de hormônios sexuais')
WHERE codigo='shbg' AND NOT ('globulina ligadora de hormônios sexuais'=ANY(aliases));
UPDATE public.avn_exames_catalogo
SET aliases = array_append(aliases,'globulina ligadora de hormônios sexuais - shbg')
WHERE codigo='shbg' AND NOT ('globulina ligadora de hormônios sexuais - shbg'=ANY(aliases));
-- Ferro sérico: só cadastrar se ainda não existir sob código, nome ou alias equivalente.
-- Não presumir intervalo de referência; usar os dados do laudo.
INSERT INTO public.avn_exames_catalogo(codigo,nome,aliases,grupo,unidade_padrao,tipo)
SELECT 'ferro_serico','Ferro sérico',
 ARRAY['ferro serico','ferro','ferro no sangue','serum iron']::text[],
 'Minerais','µg/dL','indicador'
WHERE NOT EXISTS (
 SELECT 1 FROM public.avn_exames_catalogo c
 WHERE c.codigo='ferro_serico'
 OR translate(lower(c.nome),'áàâãäéèêëíìîïóòôõöúùûüç','aaaaaeeeeiiiiooooouuuuc') IN ('ferro serico','ferro','serum iron')
 OR EXISTS (
  SELECT 1 FROM unnest(c.aliases) AS a(nome)
  WHERE translate(lower(a.nome),'áàâãäéèêëíìîïóòôõöúùûüç','aaaaaeeeeiiiiooooouuuuc') IN ('ferro serico','ferro','serum iron')
 )
)
ON CONFLICT(codigo) DO NOTHING;
-- Faixas KDIGO para adultos, independentemente de sexo. G1/G2 isolados não indicam DRC.
-- Inserção idempotente sem alterar referências já registradas.
INSERT INTO public.avn_exames_referencias
 (exame_id,laboratorio,material,metodo,sexo_referencia,idade_min_anos,idade_max_anos,
  limite_inferior,limite_superior,referencia_texto,unidade,fonte)
SELECT c.id,NULL,NULL,NULL,NULL,18,NULL,90,NULL,
 'KDIGO (adultos): G1 ≥90 (normal ou alta); G2 60–89 (levemente reduzida); G3a 45–59 (leve a moderadamente reduzida); G3b 30–44 (moderada a gravemente reduzida); G4 15–29 (gravemente reduzida); G5 <15 (falência renal). G1 e G2, isoladamente, não diagnosticam doença renal crônica.',
 'mL/min/1,73 m²','KDIGO 2024 · https://www.kidney.org/how-to-classify-ckd'
FROM public.avn_exames_catalogo c
WHERE c.codigo='tfg_estimada'
 AND NOT EXISTS (
  SELECT 1 FROM public.avn_exames_referencias r
  WHERE r.exame_id=c.id AND r.laboratorio IS NULL AND r.material IS NULL AND r.metodo IS NULL
 );
