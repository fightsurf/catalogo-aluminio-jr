CREATE TABLE IF NOT EXISTS semanas (
  id SERIAL PRIMARY KEY,
  data_inicial DATE NOT NULL,
  data_final DATE NOT NULL,
  descricao VARCHAR(100),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT semanas_data_ck CHECK (data_final >= data_inicial)
);

CREATE TABLE IF NOT EXISTS semana_carradas (
  id SERIAL PRIMARY KEY,
  semana_id INTEGER NOT NULL REFERENCES semanas(id) ON DELETE CASCADE,
  codigo_carrada INTEGER NOT NULL,
  ordem INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT semana_carradas_semana_codigo_uk UNIQUE (semana_id, codigo_carrada),
  CONSTRAINT semana_carradas_codigo_unico_uk UNIQUE (codigo_carrada)
);

CREATE INDEX IF NOT EXISTS idx_semanas_data_inicial ON semanas (data_inicial);
CREATE INDEX IF NOT EXISTS idx_semanas_data_final ON semanas (data_final);
CREATE INDEX IF NOT EXISTS idx_semanas_descricao ON semanas (descricao);
CREATE INDEX IF NOT EXISTS idx_semana_carradas_semana_id ON semana_carradas (semana_id);
CREATE INDEX IF NOT EXISTS idx_semana_carradas_codigo_carrada ON semana_carradas (codigo_carrada);
