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
('tgo','Aspartato aminotransferase (TGO/AST)',ARRAY['tgo','ast','aspartato aminotransferase'],'Função hepática','U/L','indicador'),
('tgp','Alanina aminotransferase (TGP/ALT)',ARRAY['tgp','alt','alanina aminotransferase'],'Função hepática','U/L','indicador'),
('gama_gt','Gama GT',ARRAY['ggt','gama glutamiltransferase'],'Função hepática','U/L','indicador'),
('glicemia_jejum','Glicemia de jejum',ARRAY['glicose de jejum','glicemia'],'Metabolismo','mg/dL','indicador'),
('hba1c','Hemoglobina glicada',ARRAY['hba1c','a1c'],'Metabolismo','%','indicador'),
('colesterol_total','Colesterol total',ARRAY[]::text[],'Perfil lipídico','mg/dL','indicador'),
('hdl','Colesterol HDL',ARRAY['hdl'],'Perfil lipídico','mg/dL','indicador'),
('ldl','Colesterol LDL',ARRAY['ldl'],'Perfil lipídico','mg/dL','indicador'),
('triglicerideos','Triglicerídeos',ARRAY['tg'],'Perfil lipídico','mg/dL','indicador'),
('tsh','TSH',ARRAY['hormônio tireoestimulante'],'Tireoide','µUI/mL','indicador'),
('t4_livre','T4 livre',ARRAY['ft4','tiroxina livre'],'Tireoide','ng/dL','indicador'),
('t3_livre','T3 livre',ARRAY['ft3'],'Tireoide','pg/mL','indicador'),
('testosterona_total','Testosterona total',ARRAY[]::text[],'Hormônios','ng/dL','indicador'),
('testosterona_livre','Testosterona livre',ARRAY[]::text[],'Hormônios','ng/dL','indicador'),
('shbg','SHBG',ARRAY['globulina ligadora dos hormônios sexuais'],'Hormônios','nmol/L','indicador'),
('vitamina_d','Vitamina D (25-OH)',ARRAY['25-oh vitamina d','25 hidroxi vitamina d'],'Vitaminas','ng/mL','indicador'),
('vitamina_b12','Vitamina B12',ARRAY['cobalamina'],'Vitaminas','pg/mL','indicador'),
('ferritina','Ferritina',ARRAY[]::text[],'Metabolismo','ng/mL','indicador'),
('pcr','Proteína C-reativa',ARRAY['pcr','crp'],'Inflamação','mg/L','indicador')
ON CONFLICT(codigo) DO NOTHING;