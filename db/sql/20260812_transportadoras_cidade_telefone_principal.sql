-- Alumínio JR - Logística
-- Cidade de origem da transportadora + telefone principal.
-- Ambos os campos são opcionais e não alteram o telefone legado existente.

ALTER TABLE transportadoras
ADD COLUMN IF NOT EXISTS cidade_id BIGINT REFERENCES cidades(id) ON DELETE SET NULL;

ALTER TABLE transportadoras
ADD COLUMN IF NOT EXISTS telefone_principal TEXT;

CREATE INDEX IF NOT EXISTS idx_transportadoras_cidade_id
ON transportadoras(cidade_id);
