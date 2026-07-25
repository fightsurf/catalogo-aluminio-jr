const pool = require('../../../db/connection');

let estruturaCriada = false;

async function criarEstrutura() {
  if (estruturaCriada) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ofertas (
      id BIGSERIAL PRIMARY KEY,
      codigo VARCHAR(40) NOT NULL UNIQUE,
      titulo VARCHAR(160) NOT NULL,
      status VARCHAR(24) NOT NULL DEFAULT 'rascunho',
      total NUMERIC(12,2) NOT NULL,
      preco_medio NUMERIC(12,2) NOT NULL,
      total_itens INTEGER NOT NULL,
      imagem_url TEXT,
      r2_key TEXT,
      prompt_cenario TEXT,
      expira_em TIMESTAMPTZ,
      publicado_em TIMESTAMPTZ,
      visualizacoes INTEGER NOT NULL DEFAULT 0,
      cliques_whatsapp INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS ofertas_itens (
      id BIGSERIAL PRIMARY KEY,
      oferta_id BIGINT NOT NULL REFERENCES ofertas(id) ON DELETE CASCADE,
      produto_id BIGINT,
      nome VARCHAR(220) NOT NULL,
      quantidade INTEGER NOT NULL,
      preco_unitario NUMERIC(12,2) NOT NULL,
      preco_medio NUMERIC(12,2) NOT NULL,
      foto_url TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_ofertas_status ON ofertas(status);
    CREATE INDEX IF NOT EXISTS idx_ofertas_created_at ON ofertas(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_ofertas_itens_oferta ON ofertas_itens(oferta_id);
  `);

  estruturaCriada = true;
}

module.exports = { criarEstrutura };
