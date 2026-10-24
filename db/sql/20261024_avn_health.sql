CREATE TABLE IF NOT EXISTS public.avn_metricas (
 id BIGSERIAL PRIMARY KEY,
 codigo VARCHAR(60) NOT NULL UNIQUE,
 nome VARCHAR(120) NOT NULL,
 categoria VARCHAR(50) NOT NULL,
 unidade VARCHAR(24) NOT NULL,
 origem_padrao VARCHAR(30) NOT NULL,
 ativo BOOLEAN NOT NULL DEFAULT TRUE,
 criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO public.avn_metricas (codigo,nome,categoria,unidade,origem_padrao) VALUES
 ('peso','Peso','corporal','kg','health_connect'),
 ('imc','IMC','corporal','kg/m²','calculado'),
 ('gordura_corporal','Gordura corporal','corporal','%','health_connect'),
 ('massa_magra','Massa magra','corporal','kg','health_connect'),
 ('agua_corporal','Água corporal','corporal','kg','health_connect'),
 ('massa_ossea','Massa óssea','corporal','kg','health_connect'),
 ('tmb','Metabolismo basal (TMB)','gastos','kcal/dia','health_connect'),
 ('passos','Passos','gastos','passos','health_connect'),
 ('calorias_ativas','Calorias ativas','gastos','kcal','health_connect'),
 ('calorias_totais','Calorias totais','gastos','kcal','health_connect')
ON CONFLICT (codigo) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.avn_medicoes (
 id BIGSERIAL PRIMARY KEY,
 usuario_id BIGINT NOT NULL REFERENCES public.avn_usuario(id) ON DELETE RESTRICT,
 metrica_id BIGINT NOT NULL REFERENCES public.avn_metricas(id),
 valor NUMERIC(16,5) NOT NULL,
 data_medicao TIMESTAMPTZ NOT NULL,
 data_fim TIMESTAMPTZ,
 unidade_original VARCHAR(40),
 origem VARCHAR(40) NOT NULL DEFAULT 'health_connect',
 aplicativo_origem VARCHAR(160),
 registro_externo_id VARCHAR(240),
 ultima_modificacao_origem TIMESTAMPTZ,
 qualidade VARCHAR(24) NOT NULL DEFAULT 'medido',
 metadados JSONB NOT NULL DEFAULT '{}'::jsonb,
 criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 CONSTRAINT avn_medicoes_periodo CHECK (data_fim IS NULL OR data_fim >= data_medicao),
 CONSTRAINT avn_medicoes_qualidade CHECK (qualidade IN ('medido','calculado','estimado')),
 CONSTRAINT avn_medicoes_origem CHECK (origem IN ('health_connect','manual','calculado'))
);
CREATE UNIQUE INDEX IF NOT EXISTS avn_medicoes_unq_externo ON public.avn_medicoes(usuario_id,metrica_id,origem,aplicativo_origem,registro_externo_id) WHERE registro_externo_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS avn_medicoes_historico ON public.avn_medicoes(usuario_id,metrica_id,data_medicao DESC);

CREATE TABLE IF NOT EXISTS public.avn_atividades (
 id BIGSERIAL PRIMARY KEY,
 usuario_id BIGINT NOT NULL REFERENCES public.avn_usuario(id) ON DELETE RESTRICT,
 inicio TIMESTAMPTZ NOT NULL,
 fim TIMESTAMPTZ NOT NULL,
 tipo_atividade VARCHAR(120),
 titulo VARCHAR(200),
 origem VARCHAR(40) NOT NULL DEFAULT 'health_connect',
 aplicativo_origem VARCHAR(160),
 registro_externo_id VARCHAR(240),
 calorias_kcal NUMERIC(14,4),
 metadados JSONB NOT NULL DEFAULT '{}'::jsonb,
 criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 CONSTRAINT avn_atividades_periodo CHECK (fim >= inicio)
);
CREATE UNIQUE INDEX IF NOT EXISTS avn_atividades_unq_externo ON public.avn_atividades(usuario_id,origem,aplicativo_origem,registro_externo_id) WHERE registro_externo_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS avn_atividades_historico ON public.avn_atividades(usuario_id,inicio DESC);

CREATE TABLE IF NOT EXISTS public.avn_sincronizacoes (
 id BIGSERIAL PRIMARY KEY,
 usuario_id BIGINT NOT NULL REFERENCES public.avn_usuario(id) ON DELETE RESTRICT,
 fonte VARCHAR(50) NOT NULL DEFAULT 'health_connect',
 dispositivo_id VARCHAR(160),
 iniciada_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 finalizada_em TIMESTAMPTZ,
 status VARCHAR(24) NOT NULL DEFAULT 'em_execucao',
 registros_recebidos INTEGER NOT NULL DEFAULT 0,
 registros_inseridos INTEGER NOT NULL DEFAULT 0,
 registros_atualizados INTEGER NOT NULL DEFAULT 0,
 registros_ignorados INTEGER NOT NULL DEFAULT 0,
 erro TEXT,
 cursor_sincronizacao TEXT,
 CONSTRAINT avn_sync_status CHECK (status IN ('em_execucao','concluida','erro'))
);
CREATE INDEX IF NOT EXISTS avn_sincronizacoes_usuario ON public.avn_sincronizacoes(usuario_id,iniciada_em DESC);
