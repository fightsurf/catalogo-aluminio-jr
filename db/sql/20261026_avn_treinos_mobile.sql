-- AVN Android: pareamento, execucoes e eventos por serie. Migração idempotente.
CREATE TABLE IF NOT EXISTS public.avn_treino_mobile_pareamentos (
 codigo_hash CHAR(64) PRIMARY KEY,
 usuario_id BIGINT NOT NULL REFERENCES public.avn_usuario(id) ON DELETE CASCADE,
 expira_em TIMESTAMPTZ NOT NULL,
 consumido_em TIMESTAMPTZ,
 criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS public.avn_treino_mobile_dispositivos (
 id BIGSERIAL PRIMARY KEY,
 usuario_id BIGINT NOT NULL REFERENCES public.avn_usuario(id) ON DELETE CASCADE,
 token_hash CHAR(64) UNIQUE NOT NULL,
 nome VARCHAR(120) NOT NULL DEFAULT 'Android AVN',
 criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 ultimo_acesso TIMESTAMPTZ,
 revogado_em TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS avn_treino_mobile_usuario ON public.avn_treino_mobile_dispositivos(usuario_id);
CREATE TABLE IF NOT EXISTS public.avn_treino_execucoes (
 id UUID PRIMARY KEY,
 usuario_id BIGINT NOT NULL REFERENCES public.avn_usuario(id) ON DELETE RESTRICT,
 plano_id BIGINT NOT NULL REFERENCES public.avn_planos_treino(id) ON DELETE RESTRICT,
 dia_semana SMALLINT NOT NULL CHECK (dia_semana BETWEEN 0 AND 6),
 snapshot_exercicios JSONB NOT NULL DEFAULT '[]'::jsonb,
 iniciada_em TIMESTAMPTZ NOT NULL,
 finalizada_em TIMESTAMPTZ,
 status VARCHAR(20) NOT NULL DEFAULT 'em_andamento' CHECK(status IN ('em_andamento','finalizada')),
 criada_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS avn_treino_execucoes_usuario ON public.avn_treino_execucoes(usuario_id,iniciada_em DESC);
CREATE TABLE IF NOT EXISTS public.avn_treino_execucao_eventos (
 id UUID PRIMARY KEY,
 execucao_id UUID NOT NULL REFERENCES public.avn_treino_execucoes(id) ON DELETE CASCADE,
 tipo VARCHAR(30) NOT NULL CHECK(tipo IN ('TREINO_INICIADO','SERIE_CONCLUIDA','DESCANSO_INICIADO','DESCANSO_FINALIZADO','EXERCICIO_PULADO','TREINO_FINALIZADO')),
 exercicio_id BIGINT REFERENCES public.avn_exercicios(id) ON DELETE RESTRICT,
 posicao_exercicio SMALLINT CHECK(posicao_exercicio BETWEEN 1 AND 50),
 numero_serie SMALLINT CHECK(numero_serie BETWEEN 1 AND 30),
 carga_kg NUMERIC(8,2) CHECK(carga_kg BETWEEN 0 AND 2000),
 repeticoes SMALLINT CHECK(repeticoes BETWEEN 0 AND 1000),
 rir SMALLINT CHECK(rir BETWEEN 0 AND 10),
 descanso_seg INTEGER CHECK(descanso_seg BETWEEN 0 AND 3600),
 ocorrido_em TIMESTAMPTZ NOT NULL,
 recebido_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS avn_treino_eventos_execucao ON public.avn_treino_execucao_eventos(execucao_id,ocorrido_em,id);
CREATE UNIQUE INDEX IF NOT EXISTS avn_treino_series_unicas ON public.avn_treino_execucao_eventos(execucao_id,posicao_exercicio,numero_serie) WHERE tipo='SERIE_CONCLUIDA';