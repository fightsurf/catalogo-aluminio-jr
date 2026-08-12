-- 2026-08-12
-- Nova entidade independente: Agência de Recebimento.
-- Migra os nomes de agência já gravados em carradas_pedidos_local_entrega.agencia_cidade
-- sem apagar o campo textual legado.

CREATE TABLE IF NOT EXISTS agencias_recebimento (
  codigo BIGSERIAL PRIMARY KEY,
  nome TEXT NOT NULL,
  cidade_id BIGINT REFERENCES cidades(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agencias_recebimento_nome
ON agencias_recebimento (LOWER(nome));

CREATE INDEX IF NOT EXISTS idx_agencias_recebimento_cidade_id
ON agencias_recebimento (cidade_id);

ALTER TABLE carradas_pedidos_local_entrega
ADD COLUMN IF NOT EXISTS agencia_recebimento_codigo BIGINT REFERENCES agencias_recebimento(codigo);

CREATE INDEX IF NOT EXISTS idx_carradas_local_entrega_agencia_recebimento
ON carradas_pedidos_local_entrega(agencia_recebimento_codigo);

INSERT INTO agencias_recebimento (nome)
SELECT DISTINCT ON (LOWER(BTRIM(le.agencia_cidade))) BTRIM(le.agencia_cidade)
FROM carradas_pedidos_local_entrega le
WHERE NULLIF(BTRIM(le.agencia_cidade), '') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM agencias_recebimento a
    WHERE LOWER(BTRIM(a.nome)) = LOWER(BTRIM(le.agencia_cidade))
  )
ORDER BY LOWER(BTRIM(le.agencia_cidade)), BTRIM(le.agencia_cidade);

UPDATE carradas_pedidos_local_entrega le
SET agencia_recebimento_codigo = (
  SELECT a.codigo
  FROM agencias_recebimento a
  WHERE LOWER(BTRIM(a.nome)) = LOWER(BTRIM(le.agencia_cidade))
  ORDER BY a.codigo
  LIMIT 1
)
WHERE le.agencia_recebimento_codigo IS NULL
  AND NULLIF(BTRIM(le.agencia_cidade), '') IS NOT NULL;
