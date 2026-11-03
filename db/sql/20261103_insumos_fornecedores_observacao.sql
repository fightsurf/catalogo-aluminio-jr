-- Coluna opcional de observação nos custos de insumos por fornecedor.
-- Reexecutável; o serviço aplica a mesma migração automaticamente.
ALTER TABLE public.insumos_fornecedores ADD COLUMN IF NOT EXISTS observacao TEXT;
