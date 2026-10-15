-- Perfis comerciais independentes dos perfis de visibilidade dos produtos.
-- Criados automaticamente pelo serviço na primeira utilização; arquivo também permite execução manual.
CREATE TABLE IF NOT EXISTS perfis_preco_vendedor (
  id BIGSERIAL PRIMARY KEY,
  nome VARCHAR(120) NOT NULL,
  tipo VARCHAR(16) NOT NULL CHECK (tipo IN ('percentual','fixo')),
  valor NUMERIC(12,2) NOT NULL CHECK (valor >= 0 AND valor <= 100000),
  telefone_vendedor VARCHAR(20) NOT NULL,
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  token_hash CHAR(64) NOT NULL UNIQUE,
  token_criptografado TEXT NOT NULL,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS perfis_preco_envios (
  id BIGSERIAL PRIMARY KEY,
  perfil_id BIGINT NOT NULL REFERENCES perfis_preco_vendedor(id),
  chave_cliente UUID NOT NULL,
  fingerprint CHAR(64) NOT NULL,
  modulo VARCHAR(20) NOT NULL CHECK (modulo IN ('orcamento','kit-feirinha')),
  itens JSONB NOT NULL,
  preco_base_centavos BIGINT NOT NULL,
  preco_venda_centavos BIGINT NOT NULL,
  comissao_centavos BIGINT NOT NULL,
  relatorio_pedido TEXT NOT NULL,
  relatorio_comissao TEXT NOT NULL,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (perfil_id, chave_cliente)
);
CREATE INDEX IF NOT EXISTS perfis_preco_envios_criado_idx ON perfis_preco_envios (perfil_id, criado_em DESC);

CREATE TABLE IF NOT EXISTS perfis_preco_entregas (
  id BIGSERIAL PRIMARY KEY,
  envio_id BIGINT NOT NULL REFERENCES perfis_preco_envios(id),
  telefone VARCHAR(20) NOT NULL,
  ordem SMALLINT NOT NULL CHECK (ordem IN (1,2)),
  mensagem TEXT NOT NULL,
  situacao VARCHAR(16) NOT NULL DEFAULT 'pendente'
    CHECK (situacao IN ('pendente','enviando','aceito','incerto')),
  erro TEXT,
  iniciado_em TIMESTAMPTZ,
  concluido_em TIMESTAMPTZ,
  UNIQUE (envio_id, telefone, ordem)
);
