CREATE TABLE IF NOT EXISTS carradas_status_resumo (
  codigo_carrada INTEGER PRIMARY KEY,
  status_linha VARCHAR(20) NOT NULL CHECK (status_linha IN ('incompleta', 'semicompleta', 'completa')),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

ALTER TABLE carradas_status_resumo
ADD COLUMN IF NOT EXISTS vendas_bloqueadas BOOLEAN NOT NULL DEFAULT FALSE;
