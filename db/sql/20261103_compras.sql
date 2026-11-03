-- Controle de Compras de Insumos: execução idempotente.
CREATE TABLE IF NOT EXISTS public.compras_notas (
  id BIGSERIAL PRIMARY KEY,
  fornecedor_id INTEGER NOT NULL REFERENCES public.fornecedores(id) ON DELETE RESTRICT,
  numero_nf VARCHAR(60) NOT NULL,
  data_nf DATE,
  valor_nf NUMERIC(14,2) NOT NULL CHECK (valor_nf >= 0),
  quantidade_itens_nf INTEGER NOT NULL CHECK (quantidade_itens_nf BETWEEN 1 AND 500),
  valor_frete NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (valor_frete >= 0),
  icms_frete NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (icms_frete >= 0),
  origem VARCHAR(12) NOT NULL DEFAULT 'manual' CHECK (origem IN ('manual','ia')),
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT compras_notas_fornecedor_numero_unique UNIQUE (fornecedor_id, numero_nf)
);
CREATE INDEX IF NOT EXISTS ix_compras_notas_criado_em ON public.compras_notas (criado_em DESC);
CREATE INDEX IF NOT EXISTS ix_compras_notas_fornecedor ON public.compras_notas (fornecedor_id);
CREATE TABLE IF NOT EXISTS public.compras_itens (
  id BIGSERIAL PRIMARY KEY,
  nota_id BIGINT NOT NULL REFERENCES public.compras_notas(id) ON DELETE CASCADE,
  insumo_id INTEGER REFERENCES public.insumos(id) ON DELETE SET NULL,
  descricao VARCHAR(240) NOT NULL,
  unidade VARCHAR(12) NOT NULL,
  quantidade NUMERIC(16,3) NOT NULL CHECK (quantidade > 0),
  preco_unitario NUMERIC(16,4) NOT NULL CHECK (preco_unitario >= 0),
  valor_total NUMERIC(14,2) NOT NULL CHECK (valor_total >= 0),
  posicao INTEGER NOT NULL,
  UNIQUE (nota_id, posicao)
);
CREATE INDEX IF NOT EXISTS ix_compras_itens_nota ON public.compras_itens(nota_id);
CREATE INDEX IF NOT EXISTS ix_compras_itens_insumo ON public.compras_itens(insumo_id);
