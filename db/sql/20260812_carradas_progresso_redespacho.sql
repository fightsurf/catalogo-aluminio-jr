-- 2026-08-12
-- Adiciona uma segunda transportadora (redespacho) ao Local de entrega.

ALTER TABLE carradas_pedidos_local_entrega
ADD COLUMN IF NOT EXISTS redespacho_transportadora_id BIGINT REFERENCES transportadoras(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_carradas_pedidos_local_entrega_redespacho
ON carradas_pedidos_local_entrega(redespacho_transportadora_id);
