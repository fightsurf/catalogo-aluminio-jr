CREATE TABLE IF NOT EXISTS cliente_credito_lancamentos (
  id BIGSERIAL PRIMARY KEY,
  favorecido INTEGER NOT NULL,
  cliente_nome_snapshot VARCHAR(200),
  data_lancamento DATE NOT NULL DEFAULT CURRENT_DATE,
  tipo VARCHAR(40) NOT NULL CHECK (tipo IN ('BAIXA_PARA_CREDITO', 'PAGAMENTO_CLIENTE', 'AJUSTE_DEBITO', 'AJUSTE_CREDITO', 'ESTORNO')),
  descricao TEXT,
  numero_pedido VARCHAR(50),
  origem_tipo VARCHAR(60),
  origem_empresa INTEGER,
  origem_saida BIGINT,
  origem_pdv INTEGER,
  origem_id VARCHAR(80),
  valor_debito NUMERIC(14,2) NOT NULL DEFAULT 0,
  valor_credito NUMERIC(14,2) NOT NULL DEFAULT 0,
  observacao TEXT,
  cancelado_em TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_cliente_credito_baixa_pedido
ON cliente_credito_lancamentos (origem_empresa, origem_saida, origem_pdv)
WHERE tipo = 'BAIXA_PARA_CREDITO' AND cancelado_em IS NULL;

CREATE INDEX IF NOT EXISTS idx_cliente_credito_favorecido
ON cliente_credito_lancamentos (favorecido, data_lancamento, id);

CREATE INDEX IF NOT EXISTS idx_cliente_credito_origem_pedido
ON cliente_credito_lancamentos (origem_empresa, origem_saida, origem_pdv);
