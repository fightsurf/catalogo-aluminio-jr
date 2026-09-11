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
      facebook_story_status VARCHAR(24) NOT NULL DEFAULT 'nao_publicado',
      facebook_story_publicado_em TIMESTAMPTZ,
      facebook_story_post_id VARCHAR(100),
      facebook_story_erro TEXT,
      facebook_feed_status VARCHAR(24) NOT NULL DEFAULT 'nao_publicado',
      facebook_feed_publicado_em TIMESTAMPTZ,
      facebook_feed_post_id VARCHAR(100),
      facebook_feed_erro TEXT,
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
    ALTER TABLE ofertas ADD COLUMN IF NOT EXISTS facebook_story_status VARCHAR(24) NOT NULL DEFAULT 'nao_publicado';
    ALTER TABLE ofertas ADD COLUMN IF NOT EXISTS facebook_story_publicado_em TIMESTAMPTZ;
    ALTER TABLE ofertas ADD COLUMN IF NOT EXISTS facebook_story_post_id VARCHAR(100);
    ALTER TABLE ofertas ADD COLUMN IF NOT EXISTS facebook_story_erro TEXT;
    ALTER TABLE ofertas ADD COLUMN IF NOT EXISTS facebook_feed_status VARCHAR(24) NOT NULL DEFAULT 'nao_publicado';
    ALTER TABLE ofertas ADD COLUMN IF NOT EXISTS facebook_feed_publicado_em TIMESTAMPTZ;
    ALTER TABLE ofertas ADD COLUMN IF NOT EXISTS facebook_feed_post_id VARCHAR(100);
    ALTER TABLE ofertas ADD COLUMN IF NOT EXISTS facebook_feed_erro TEXT;

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

    CREATE TABLE IF NOT EXISTS ofertas_publicacoes_historico (
      id BIGSERIAL PRIMARY KEY,
      oferta_id BIGINT NOT NULL,
      assinatura JSONB NOT NULL,
      publicado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      dados JSONB NOT NULL,
      legado BOOLEAN NOT NULL DEFAULT FALSE
    );
    CREATE INDEX IF NOT EXISTS idx_ofertas_publicacoes_assinatura
      ON ofertas_publicacoes_historico (assinatura, publicado_em DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_ofertas_publicacoes_legado
      ON ofertas_publicacoes_historico (oferta_id) WHERE legado;

    -- Os registros antigos têm preços da criação, não da publicação.
    INSERT INTO ofertas_publicacoes_historico (oferta_id, assinatura, publicado_em, dados, legado)
    SELECT o.id, a.assinatura, COALESCE(o.publicado_em, o.whatsapp_publicado_em,
      o.instagram_publicado_em, o.facebook_story_publicado_em, o.facebook_feed_publicado_em),
      jsonb_build_object('id', o.id, 'codigo', o.codigo, 'itens', a.itens,
        'total', o.total, 'preco_medio', o.preco_medio, 'total_itens', o.total_itens), TRUE
    FROM ofertas o
    CROSS JOIN LATERAL (
      SELECT jsonb_agg(jsonb_build_array(g.produto_id::text, g.quantidade) ORDER BY g.produto_id) assinatura,
        (SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM ofertas_itens i WHERE i.oferta_id=o.id) itens
      FROM (SELECT produto_id, SUM(quantidade) quantidade FROM ofertas_itens
            WHERE oferta_id=o.id GROUP BY produto_id) g
    ) a
    WHERE COALESCE(o.publicado_em, o.whatsapp_publicado_em, o.instagram_publicado_em,
        o.facebook_story_publicado_em, o.facebook_feed_publicado_em) IS NOT NULL
      AND a.assinatura IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM ofertas_publicacoes_historico h WHERE h.oferta_id=o.id)
    ON CONFLICT DO NOTHING;

    CREATE INDEX IF NOT EXISTS idx_ofertas_status ON ofertas(status);
    CREATE INDEX IF NOT EXISTS idx_ofertas_created_at ON ofertas(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_ofertas_itens_oferta ON ofertas_itens(oferta_id);
  `);

  estruturaCriada = true;
}

module.exports = { criarEstrutura };
