-- Dados de sono obtidos diretamente do Samsung Health. Não reutilizar avn_medicoes:
-- estágio e sessão são registros intervalares, com identidade de origem própria.
CREATE TABLE IF NOT EXISTS public.avn_sono_sessoes (
 id BIGSERIAL PRIMARY KEY,
 usuario_id BIGINT NOT NULL REFERENCES public.avn_usuario(id) ON DELETE RESTRICT,
 origem VARCHAR(40) NOT NULL DEFAULT 'samsung_health',
 registro_externo_id VARCHAR(240) NOT NULL,
 inicio TIMESTAMPTZ NOT NULL,
 fim TIMESTAMPTZ NOT NULL,
 duracao_min INTEGER,
 pontuacao SMALLINT,
 sessoes_quantidade SMALLINT NOT NULL DEFAULT 0,
 criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 CONSTRAINT avn_sono_periodo CHECK (fim >= inicio),
 CONSTRAINT avn_sono_duracao CHECK (duracao_min IS NULL OR duracao_min BETWEEN 0 AND 4320),
 CONSTRAINT avn_sono_pontuacao CHECK (pontuacao IS NULL OR pontuacao BETWEEN 0 AND 100),
 CONSTRAINT avn_sono_qtd CHECK (sessoes_quantidade BETWEEN 0 AND 30),
 CONSTRAINT avn_sono_origem CHECK (origem = 'samsung_health'),
 CONSTRAINT avn_sono_unico UNIQUE (usuario_id, origem, registro_externo_id)
);
CREATE INDEX IF NOT EXISTS avn_sono_sessoes_usuario_inicio
 ON public.avn_sono_sessoes (usuario_id, inicio DESC);
CREATE TABLE IF NOT EXISTS public.avn_sono_estagios (
 sessao_id BIGINT NOT NULL REFERENCES public.avn_sono_sessoes(id) ON DELETE CASCADE,
 posicao SMALLINT NOT NULL,
 tipo VARCHAR(12) NOT NULL,
 inicio TIMESTAMPTZ NOT NULL,
 fim TIMESTAMPTZ NOT NULL,
 PRIMARY KEY (sessao_id, posicao),
 CONSTRAINT avn_sono_estagio_periodo CHECK (fim >= inicio),
 CONSTRAINT avn_sono_estagio_tipo CHECK (tipo IN ('UNDEFINED','AWAKE','LIGHT','DEEP','REM'))
);