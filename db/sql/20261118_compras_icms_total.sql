-- Valor de ICMS destacado na NF, separado do ICMS do frete.
-- Idempotente: preserva todas as notas fiscais anteriores.
ALTER TABLE public.compras_notas
  ADD COLUMN IF NOT EXISTS icms_total NUMERIC(14,2) CHECK (icms_total >= 0);
