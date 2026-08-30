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
      tema_arte VARCHAR(24) NOT NULL DEFAULT 'claro',
      cores_arte JSONB NOT NULL DEFAULT '{}'::jsonb,
      expira_em TIMESTAMPTZ,
      publicado_em TIMESTAMPTZ,
      whatsapp_status VARCHAR(24) NOT NULL DEFAULT 'nao_publicado',
      whatsapp_publicado_em TIMESTAMPTZ,
      whatsapp_erro TEXT,
      instagram_status VARCHAR(24) NOT NULL DEFAULT 'nao_publicado',
      instagram_publicado_em TIMESTAMPTZ,
      instagram_media_id VARCHAR(80),
      instagram_container_id VARCHAR(80),
      instagram_erro TEXT,
      visualizacoes INTEGER NOT NULL DEFAULT 0,
      cliques_whatsapp INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE ofertas ADD COLUMN IF NOT EXISTS tema_arte VARCHAR(24) NOT NULL DEFAULT 'claro';
    ALTER TABLE ofertas ADD COLUMN IF NOT EXISTS cores_arte JSONB NOT NULL DEFAULT '{}'::jsonb;
    ALTER TABLE ofertas ADD COLUMN IF NOT EXISTS whatsapp_status VARCHAR(24) NOT NULL DEFAULT 'nao_publicado';
    ALTER TABLE ofertas ADD COLUMN IF NOT EXISTS whatsapp_publicado_em TIMESTAMPTZ;
    ALTER TABLE ofertas ADD COLUMN IF NOT EXISTS whatsapp_erro TEXT;
    ALTER TABLE ofertas ADD COLUMN IF NOT EXISTS instagram_status VARCHAR(24) NOT NULL DEFAULT 'nao_publicado';
    ALTER TABLE ofertas ADD COLUMN IF NOT EXISTS instagram_publicado_em TIMESTAMPTZ;
    ALTER TABLE ofertas ADD COLUMN IF NOT EXISTS instagram_media_id VARCHAR(80);
    ALTER TABLE ofertas ADD COLUMN IF NOT EXISTS instagram_container_id VARCHAR(80);
    ALTER TABLE ofertas ADD COLUMN IF NOT EXISTS instagram_erro TEXT;

    UPDATE ofertas
    SET whatsapp_status = 'publicado',
        whatsapp_publicado_em = COALESCE(whatsapp_publicado_em, publicado_em)
    WHERE status = 'publicada'
      AND whatsapp_status = 'nao_publicado'
      AND publicado_em IS NOT NULL;

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
