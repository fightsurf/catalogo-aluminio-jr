-- Mala Direta Alumínio JR - SQL de referência / implantação manual se necessário.
-- O módulo cria a estrutura automaticamente na primeira consulta.
CREATE TABLE IF NOT EXISTS mala_direta_campanhas (
 id BIGSERIAL PRIMARY KEY,
 produto_id BIGINT NOT NULL REFERENCES produtos(id),
 item_legado BIGINT NOT NULL,
 produto_nome TEXT NOT NULL,
 meses INTEGER NOT NULL DEFAULT 0,
 mensagem TEXT NOT NULL,
 imagem TEXT NOT NULL,
 intervalo_segundos INTEGER NOT NULL,
 status VARCHAR(20) NOT NULL DEFAULT 'ativa',
 proximo_envio_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 criada_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 iniciada_em TIMESTAMPTZ,
 concluida_em TIMESTAMPTZ,
 CHECK(status IN ('ativa','pausada','concluida'))
);
CREATE TABLE IF NOT EXISTS mala_direta_destinatarios (
 id BIGSERIAL PRIMARY KEY,
 campanha_id BIGINT NOT NULL REFERENCES mala_direta_campanhas(id),
 favorecido BIGINT NOT NULL,
 nome TEXT NOT NULL,
 telefone VARCHAR(20) NOT NULL,
 status VARCHAR(24) NOT NULL DEFAULT 'pendente',
 enviado_em TIMESTAMPTZ,
 atualizado_em TIMESTAMPTZ,
 erro TEXT,
 retorno_zapi JSONB,
 UNIQUE(campanha_id,favorecido),
 CHECK(status IN ('pendente','enviando','enviado','erro','incerto','bloqueado'))
);
CREATE INDEX IF NOT EXISTS idx_mala_direta_fila ON mala_direta_destinatarios (campanha_id,id) WHERE status='pendente';
CREATE TABLE IF NOT EXISTS mala_direta_bloqueios (
 telefone VARCHAR(20) PRIMARY KEY,
 motivo TEXT,
 criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
