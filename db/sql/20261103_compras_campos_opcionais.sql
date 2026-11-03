-- Permite cadastrar uma NF com apenas fornecedor e número.
-- Execute após 20261103_compras.sql. Idempotente e preserva os lançamentos existentes.
ALTER TABLE public.compras_notas
  ALTER COLUMN valor_nf DROP NOT NULL,
  ALTER COLUMN quantidade_itens_nf DROP NOT NULL,
  ALTER COLUMN valor_frete DROP NOT NULL,
  ALTER COLUMN valor_frete DROP DEFAULT,
  ALTER COLUMN icms_frete DROP NOT NULL,
  ALTER COLUMN icms_frete DROP DEFAULT;
-- Itens incompletos extraídos da IA podem ser conferidos/complementados depois.
ALTER TABLE public.compras_itens
  ALTER COLUMN quantidade DROP NOT NULL,
  ALTER COLUMN preco_unitario DROP NOT NULL,
  ALTER COLUMN valor_total DROP NOT NULL;
