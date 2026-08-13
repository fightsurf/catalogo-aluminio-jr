-- 2026-08-13
-- Acrescenta telefone opcional à entidade Agência de Recebimento.

ALTER TABLE agencias_recebimento
ADD COLUMN IF NOT EXISTS telefone TEXT;
