-- Uma NF pode ter zero, um ou vários títulos/boletos.
-- Execução idempotente no startup, sem alterar notas e insumos existentes.
CREATE TABLE IF NOT EXISTS public.compras_boletos (
  id BIGSERIAL PRIMARY KEY,
  nota_id BIGINT NOT NULL REFERENCES public.compras_notas(id) ON DELETE CASCADE,
  tipo VARCHAR(12) NOT NULL DEFAULT 'boleto' CHECK (tipo IN ('boleto','duplicata')),
  parcela VARCHAR(30),
  numero_documento VARCHAR(80),
  nosso_numero VARCHAR(80),
  banco VARCHAR(120),
  vencimento DATE NOT NULL,
  valor NUMERIC(14,2) NOT NULL CHECK (valor > 0),
  linha_digitavel VARCHAR(48),
  codigo_barras VARCHAR(44),
  status VARCHAR(16) NOT NULL DEFAULT 'pendente'
    CHECK (status IN ('a_confirmar','pendente','pago','cancelado')),
  data_pagamento DATE,
  valor_pago NUMERIC(14,2) CHECK (valor_pago >= 0),
  observacao VARCHAR(400),
  origem VARCHAR(12) NOT NULL DEFAULT 'manual' CHECK (origem IN ('manual','ia')),
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_compras_boletos_nota_vencimento
  ON public.compras_boletos(nota_id,vencimento);
CREATE INDEX IF NOT EXISTS ix_compras_boletos_status_vencimento
  ON public.compras_boletos(status,vencimento);
CREATE UNIQUE INDEX IF NOT EXISTS ux_compras_boletos_linha
  ON public.compras_boletos(nota_id,linha_digitavel) WHERE linha_digitavel IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_compras_boletos_codigo
  ON public.compras_boletos(nota_id,codigo_barras) WHERE codigo_barras IS NOT NULL;
