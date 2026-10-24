-- Módulo AVN Nutrição v1: só objetos novos, migração idempotente.
CREATE TABLE IF NOT EXISTS public.avn_alimentos (
 id BIGSERIAL PRIMARY KEY,
 usuario_id BIGINT REFERENCES public.avn_usuario(id) ON DELETE RESTRICT,
 nome VARCHAR(180) NOT NULL,
 marca VARCHAR(120),
 preparo VARCHAR(120),
 fonte VARCHAR(40) NOT NULL DEFAULT 'manual',
 fonte_referencia VARCHAR(240),
 kcal_100g NUMERIC(12,4),
 proteinas_g_100g NUMERIC(12,4),
 carboidratos_g_100g NUMERIC(12,4),
 gorduras_g_100g NUMERIC(12,4),
 fibras_g_100g NUMERIC(12,4),
 micronutrientes_100g JSONB NOT NULL DEFAULT '{}'::jsonb,
 porcao_nome VARCHAR(100),
 porcao_gramas NUMERIC(10,3),
 ativo BOOLEAN NOT NULL DEFAULT TRUE,
 criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 CONSTRAINT avn_alimentos_kcal CHECK (kcal_100g IS NULL OR kcal_100g BETWEEN 0 AND 1000),
 CONSTRAINT avn_alimentos_proteinas CHECK (proteinas_g_100g IS NULL OR proteinas_g_100g BETWEEN 0 AND 100),
 CONSTRAINT avn_alimentos_carbo CHECK (carboidratos_g_100g IS NULL OR carboidratos_g_100g BETWEEN 0 AND 100),
 CONSTRAINT avn_alimentos_gorduras CHECK (gorduras_g_100g IS NULL OR gorduras_g_100g BETWEEN 0 AND 100),
 CONSTRAINT avn_alimentos_fibras CHECK (fibras_g_100g IS NULL OR fibras_g_100g BETWEEN 0 AND 100),
 CONSTRAINT avn_alimentos_porcao CHECK (porcao_gramas IS NULL OR porcao_gramas > 0)
);
CREATE INDEX IF NOT EXISTS avn_alimentos_usuario_nome ON public.avn_alimentos(usuario_id, LOWER(nome));

CREATE TABLE IF NOT EXISTS public.avn_metas_nutricionais (
 usuario_id BIGINT PRIMARY KEY REFERENCES public.avn_usuario(id) ON DELETE RESTRICT,
 kcal NUMERIC(12,2),
 proteinas_g NUMERIC(12,2),
 carboidratos_g NUMERIC(12,2),
 gorduras_g NUMERIC(12,2),
 fibras_g NUMERIC(12,2),
 micros JSONB NOT NULL DEFAULT '{}'::jsonb,
 atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 CONSTRAINT avn_metas_kcal CHECK (kcal IS NULL OR kcal BETWEEN 0 AND 12000)
);
CREATE TABLE IF NOT EXISTS public.avn_dieta_planos (
 id BIGSERIAL PRIMARY KEY,
 usuario_id BIGINT NOT NULL REFERENCES public.avn_usuario(id) ON DELETE RESTRICT,
 nome VARCHAR(120) NOT NULL DEFAULT 'Dieta semanal',
 ativo BOOLEAN NOT NULL DEFAULT FALSE,
 criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS avn_dieta_plano_ativo_por_usuario ON public.avn_dieta_planos(usuario_id) WHERE ativo=TRUE;
CREATE TABLE IF NOT EXISTS public.avn_dieta_itens (
 id BIGSERIAL PRIMARY KEY,
 plano_id BIGINT NOT NULL REFERENCES public.avn_dieta_planos(id) ON DELETE CASCADE,
 dia_semana SMALLINT NOT NULL CHECK (dia_semana BETWEEN 0 AND 6),
 refeicao VARCHAR(30) NOT NULL,
 alimento_id BIGINT NOT NULL REFERENCES public.avn_alimentos(id) ON DELETE RESTRICT,
 quantidade_g NUMERIC(12,3) NOT NULL CHECK (quantidade_g > 0 AND quantidade_g <= 10000),
 ordem INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS avn_dieta_itens_plano_dia ON public.avn_dieta_itens(plano_id,dia_semana,ordem,id);
CREATE TABLE IF NOT EXISTS public.avn_diario_alimentar (
 id BIGSERIAL PRIMARY KEY,
 usuario_id BIGINT NOT NULL REFERENCES public.avn_usuario(id) ON DELETE RESTRICT,
 data_consumo DATE NOT NULL,
 refeicao VARCHAR(30) NOT NULL,
 alimento_id BIGINT REFERENCES public.avn_alimentos(id) ON DELETE RESTRICT,
 alimento_nome VARCHAR(180) NOT NULL,
 quantidade_g NUMERIC(12,3) NOT NULL CHECK (quantidade_g > 0 AND quantidade_g <= 10000),
 composicao_100g JSONB NOT NULL,
 plano_item_id BIGINT REFERENCES public.avn_dieta_itens(id) ON DELETE SET NULL,
 criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS avn_diario_alimentar_usuario_data ON public.avn_diario_alimentar(usuario_id,data_consumo,refeicao,id);
CREATE UNIQUE INDEX IF NOT EXISTS avn_diario_alimentar_item_planejado_unico ON public.avn_diario_alimentar(usuario_id,data_consumo,plano_item_id) WHERE plano_item_id IS NOT NULL;

-- Catálogo ABERTO: novos micronutrientes podem ser criados pelo administrador.
-- O código identifica o nutriente E A UNIDADE, que não pode ser alterada após cadastro.
-- Não representa dados do alimento: os valores reais são cadastrados separadamente.
CREATE TABLE IF NOT EXISTS public.avn_nutrientes (
 codigo VARCHAR(100) PRIMARY KEY,
 nome VARCHAR(160) NOT NULL,
 unidade VARCHAR(24) NOT NULL,
 categoria VARCHAR(40) NOT NULL DEFAULT 'Outros',
 criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 CONSTRAINT avn_nutrientes_codigo_chk CHECK (codigo ~ '^[a-z][a-z0-9_]{1,99}$'),
 CONSTRAINT avn_nutrientes_nome_chk CHECK (length(btrim(nome)) > 0),
 CONSTRAINT avn_nutrientes_unidade_chk CHECK (length(btrim(unidade)) > 0)
);
CREATE INDEX IF NOT EXISTS avn_nutrientes_nome_idx ON public.avn_nutrientes (LOWER(nome));
-- Valores padrão são definições vazias, não composições nutricionais de alimentos.
INSERT INTO public.avn_nutrientes(codigo,nome,unidade,categoria) VALUES
 ('sodio_mg','Sódio','mg','Minerais'),
 ('potassio_mg','Potássio','mg','Minerais'),
 ('calcio_mg','Cálcio','mg','Minerais'),
 ('ferro_mg','Ferro','mg','Minerais'),
 ('magnesio_mg','Magnésio','mg','Minerais'),
 ('zinco_mg','Zinco','mg','Minerais'),
 ('selenio_ug','Selênio','µg','Minerais'),
 ('fosforo_mg','Fósforo','mg','Minerais'),
 ('cobre_mg','Cobre','mg','Minerais'),
 ('manganes_mg','Manganês','mg','Minerais'),
 ('iodo_ug','Iodo','µg','Minerais'),
 ('cloreto_mg','Cloreto','mg','Minerais'),
 ('cromo_ug','Cromo','µg','Minerais'),
 ('molibdenio_ug','Molibdênio','µg','Minerais'),
 ('fluoreto_mg','Fluoreto','mg','Minerais'),
 ('boro_mg','Boro','mg','Minerais'),
 ('enxofre_mg','Enxofre','mg','Minerais'),
 ('vitamina_a_ug','Vitamina A','µg','Vitaminas'),
 ('vitamina_b1_mg','Vitamina B1 (tiamina)','mg','Vitaminas'),
 ('vitamina_b2_mg','Vitamina B2 (riboflavina)','mg','Vitaminas'),
 ('vitamina_b3_mg','Vitamina B3 (niacina)','mg','Vitaminas'),
 ('vitamina_b5_mg','Vitamina B5 (ácido pantotênico)','mg','Vitaminas'),
 ('vitamina_b6_mg','Vitamina B6','mg','Vitaminas'),
 ('vitamina_b7_ug','Vitamina B7 (biotina)','µg','Vitaminas'),
 ('folato_ug','Folato (B9)','µg','Vitaminas'),
 ('vitamina_b12_ug','Vitamina B12','µg','Vitaminas'),
 ('vitamina_c_mg','Vitamina C','mg','Vitaminas'),
 ('vitamina_d_ug','Vitamina D','µg','Vitaminas'),
 ('vitamina_e_mg','Vitamina E','mg','Vitaminas'),
 ('vitamina_k_ug','Vitamina K','µg','Vitaminas'),
 ('vitamina_k1_ug','Vitamina K1','µg','Vitaminas'),
 ('vitamina_k2_ug','Vitamina K2','µg','Vitaminas'),
 ('retinol_ug','Retinol','µg','Vitaminas'),
 ('betacaroteno_ug','Betacaroteno','µg','Outros'),
 ('alfacaroteno_ug','Alfacaroteno','µg','Outros'),
 ('licopeno_ug','Licopeno','µg','Outros'),
 ('luteina_zeaxantina_ug','Luteína + zeaxantina','µg','Outros'),
 ('colina_mg','Colina','mg','Outros'),
 ('betaina_mg','Betaína','mg','Outros'),
 ('colesterol_mg','Colesterol','mg','Outros'),
 ('acucares_g','Açúcares totais','g','Outros'),
 ('acucar_adicionado_g','Açúcares adicionados','g','Outros'),
 ('gordura_saturada_g','Gordura saturada','g','Outros'),
 ('gordura_monoinsaturada_g','Gordura monoinsaturada','g','Outros'),
 ('gordura_poliinsaturada_g','Gordura poli-insaturada','g','Outros'),
 ('gordura_trans_g','Gordura trans','g','Outros'),
 ('omega3_g','Ômega-3','g','Outros'),
 ('omega6_g','Ômega-6','g','Outros'),
 ('epa_mg','EPA','mg','Outros'),
 ('dha_mg','DHA','mg','Outros'),
 ('ala_mg','ALA (ácido alfa-linolênico)','mg','Outros'),
 ('amido_g','Amido','g','Outros'),
 ('poliois_g','Polióis','g','Outros'),
 ('cafeina_mg','Cafeína','mg','Outros'),
 ('teobromina_mg','Teobromina','mg','Outros'),
 ('agua_g','Água no alimento','g','Outros')
ON CONFLICT(codigo) DO NOTHING;
