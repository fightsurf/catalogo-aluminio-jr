const pool = require('../../../db/connection');

let estruturaPronta = null;

async function criarEstrutura() {
  if (estruturaPronta) return estruturaPronta;

  estruturaPronta = (async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS termometro_aparicoes (
        id BIGSERIAL PRIMARY KEY,
        produto_id BIGINT NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
        origem VARCHAR(32) NOT NULL,
        origem_chave VARCHAR(180) NOT NULL,
        origem_id BIGINT,
        quantidade INTEGER NOT NULL DEFAULT 1,
        publicado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        detalhes JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT chk_termometro_aparicoes_quantidade CHECK (quantidade > 0),
        CONSTRAINT uq_termometro_aparicoes_origem UNIQUE (origem, origem_chave, produto_id)
      );

      CREATE INDEX IF NOT EXISTS idx_termometro_aparicoes_data
        ON termometro_aparicoes (publicado_em DESC);

      CREATE INDEX IF NOT EXISTS idx_termometro_aparicoes_produto_data
        ON termometro_aparicoes (produto_id, publicado_em DESC);

      CREATE INDEX IF NOT EXISTS idx_termometro_aparicoes_origem_data
        ON termometro_aparicoes (origem, publicado_em DESC);
    `);

    // Backfill possível para a Central de Ofertas já existente.
    // O histórico antigo do Status Zap não era persistido, portanto não pode ser reconstruído.
    const tabelasOfertas = await pool.query(`
      SELECT
        to_regclass('public.ofertas') AS ofertas,
        to_regclass('public.ofertas_itens') AS ofertas_itens
    `);

    if (tabelasOfertas.rows[0]?.ofertas && tabelasOfertas.rows[0]?.ofertas_itens) {
      await pool.query(`
        INSERT INTO termometro_aparicoes
          (produto_id, origem, origem_chave, origem_id, quantidade, publicado_em, detalhes)
        SELECT
          agrupado.produto_id,
          'central_ofertas',
          'historico-oferta:' || agrupado.oferta_id::text,
          agrupado.oferta_id,
          agrupado.quantidade,
          agrupado.publicado_em,
          jsonb_build_object('backfill', true, 'codigo_oferta', agrupado.codigo)
        FROM (
          SELECT
            o.id AS oferta_id,
            o.codigo,
            oi.produto_id,
            SUM(oi.quantidade)::int AS quantidade,
            o.publicado_em
          FROM ofertas o
          JOIN ofertas_itens oi ON oi.oferta_id = o.id
          JOIN produtos p ON p.id = oi.produto_id
          WHERE o.status = 'publicada'
            AND o.publicado_em IS NOT NULL
            AND oi.produto_id IS NOT NULL
          GROUP BY o.id, o.codigo, oi.produto_id, o.publicado_em
        ) agrupado
        ON CONFLICT (origem, origem_chave, produto_id) DO NOTHING
      `);
    }
  })().catch((error) => {
    estruturaPronta = null;
    throw error;
  });

  return estruturaPronta;
}

module.exports = {
  criarEstrutura
};
