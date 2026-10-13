const pool = require('../../../db/connection');
const legadoBridgeService = require('../legado/legadoBridge.service');
const schemaService = require('./termometroSchema.service');

let estruturaPronta = null;
async function prepararConfiguracao() {
  if (estruturaPronta) return estruturaPronta;
  estruturaPronta = pool.query(`
    CREATE TABLE IF NOT EXISTS termometro_produtos_monitorados (
      produto_id BIGINT PRIMARY KEY REFERENCES produtos(id) ON DELETE CASCADE,
      ordem INTEGER NOT NULL DEFAULT 0,
      cadastrado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `).catch((error) => {
    estruturaPronta = null;
    throw error;
  });
  return estruturaPronta;
}

function mesReferencia() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Fortaleza', year: 'numeric', month: '2-digit'
  }).formatToParts(new Date());
  const m = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return { ano: Number(m.year), mes: Number(m.month) };
}

function mesesPainel() {
  const { ano, mes } = mesReferencia();
  return [-1, 0, 1].map((offset) => {
    const d = new Date(Date.UTC(ano, mes - 1 + offset, 1));
    const anoMes = d.getUTCFullYear();
    const numeroMes = d.getUTCMonth() + 1;
    return {
      ano: anoMes,
      mes: numeroMes,
      chave: `${anoMes}-${String(numeroMes).padStart(2, '0')}`,
      rotulo: new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(d)
    };
  });
}

async function listarConfiguracao() {
  await prepararConfiguracao();
  const [produtos, selecionados] = await Promise.all([
    pool.query(`
      SELECT p.id, p.nome, p.item_legado, p.ativo
      FROM produtos p
      WHERE p.ativo = true OR EXISTS (
        SELECT 1 FROM termometro_produtos_monitorados tm WHERE tm.produto_id = p.id
      )
      ORDER BY p.nome COLLATE "default", p.id
    `),
    pool.query('SELECT produto_id FROM termometro_produtos_monitorados ORDER BY ordem, produto_id')
  ]);
  return {
    produtos: produtos.rows.map((p) => ({
      id: Number(p.id), nome: p.nome, item_legado: p.item_legado ? Number(p.item_legado) : null,
      ativo: Boolean(p.ativo)
    })),
    selecionados: selecionados.rows.map((p) => Number(p.produto_id))
  };
}

async function salvarConfiguracao(produtosIds) {
  if (!Array.isArray(produtosIds) || produtosIds.length > 500) {
    const error = new Error('Informe uma lista de até 500 produtos.'); error.status = 400; throw error;
  }
  const ids = produtosIds.map(Number);
  if (ids.some((id) => !Number.isSafeInteger(id) || id <= 0) || new Set(ids).size !== ids.length) {
    const error = new Error('IDs de produtos inválidos ou duplicados.'); error.status = 400; throw error;
  }
  await prepararConfiguracao();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Evita gravações simultâneas concorrentes da mesma configuração global.
    await client.query('SELECT pg_advisory_xact_lock(17321011)');
    if (ids.length) {
      const validos = await client.query('SELECT id FROM produtos WHERE id = ANY($1::bigint[])', [ids]);
      if (validos.rowCount !== ids.length) {
        const error = new Error('Um ou mais produtos não existem.'); error.status = 400; throw error;
      }
    }
    await client.query('DELETE FROM termometro_produtos_monitorados');
    if (ids.length) {
      await client.query(`
        INSERT INTO termometro_produtos_monitorados (produto_id, ordem)
        SELECT entrada.id, entrada.posicao - 1
        FROM UNNEST($1::bigint[]) WITH ORDINALITY AS entrada(id, posicao)
      `, [ids]);
    }
    await client.query('COMMIT');
    return { selecionados: ids };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function carregarPainel() {
  await Promise.all([prepararConfiguracao(), schemaService.criarEstrutura()]);
  const meses = mesesPainel();
  const selecionados = await pool.query(`
    SELECT p.id, p.nome, p.item_legado, tm.ordem
    FROM termometro_produtos_monitorados tm
    JOIN produtos p ON p.id = tm.produto_id
    ORDER BY tm.ordem, tm.produto_id
  `);
  const produtos = selecionados.rows.map((p) => ({
    id: Number(p.id), nome: p.nome,
    item_legado: p.item_legado ? Number(p.item_legado) : null,
    ordem: Number(p.ordem)
  }));
  const vazios = meses.map((mes) => ({ ...mes, vendas: 0, divulgacoes: 0 }));
  if (!produtos.length) return { meses, itens: [], totais: vazios };

  const ids = produtos.map((produto) => produto.id);
  const codigos = [...new Set(produtos.map((produto) => produto.item_legado).filter((id) => id))];
  const inicio = `${meses[0].chave}-01T00:00:00-03:00`;
  const ultimo = meses[2];
  const fimDate = new Date(Date.UTC(ultimo.ano, ultimo.mes, 1));
  const fim = `${fimDate.getUTCFullYear()}-${String(fimDate.getUTCMonth() + 1).padStart(2, '0')}-01T00:00:00-03:00`;

  // COUNT, não SUM(quantidade): uma publicação por módulo/produto.
  // A rede de destino e a quantidade do kit não multiplicam as divulgações.
  const [publicacoes, vendasResponse] = await Promise.all([
    pool.query(`
      SELECT produto_id,
        TO_CHAR(publicado_em AT TIME ZONE 'America/Fortaleza', 'YYYY-MM') AS mes_chave,
        COUNT(*)::int AS total
      FROM termometro_aparicoes
      WHERE produto_id = ANY($1::bigint[])
        AND origem IN ('central_ofertas', 'status_zap', 'status_videos')
        AND publicado_em >= $2::timestamptz AND publicado_em < $3::timestamptz
      GROUP BY produto_id, TO_CHAR(publicado_em AT TIME ZONE 'America/Fortaleza', 'YYYY-MM')
    `, [ids, inicio, fim]),
    codigos.length
      ? legadoBridgeService.post('/api/vendas/termometro-vendas/painel-carradas', {
          mes: meses[1].mes, ano: meses[1].ano, itens: codigos
        })
      : Promise.resolve({ dados: { itens: [] } })
  ]);

  const mapaDiv = new Map(publicacoes.rows.map((row) => [
    `${Number(row.produto_id)}:${row.mes_chave}`, Number(row.total || 0)
  ]));
  const mapaVendas = new Map((vendasResponse?.dados?.itens || []).map((row) => [
    `${Number(row.item)}:${Number(row.ano)}-${String(Number(row.mes)).padStart(2, '0')}`,
    Number(row.quantidade || 0)
  ]));
  const itens = produtos.map((produto) => ({
    ...produto,
    meses: meses.map((mes) => ({
      chave: mes.chave,
      vendas: produto.item_legado ? Number(mapaVendas.get(`${produto.item_legado}:${mes.chave}`) || 0) : null,
      divulgacoes: Number(mapaDiv.get(`${produto.id}:${mes.chave}`) || 0)
    }))
  }));
  // Dois produtos podem compartilhar o mesmo código legado. No resumo geral,
  // conta-se cada código uma vez para não inflar artificialmente o total.
  const totais = meses.map((mes, indice) => {
    const jaContados = new Set();
    let vendas = 0;
    for (const produto of itens) {
      if (!produto.item_legado || jaContados.has(produto.item_legado)) continue;
      jaContados.add(produto.item_legado);
      vendas += Number(produto.meses[indice].vendas || 0);
    }
    return {
      ...mes,
      vendas: Number(vendas.toFixed(3)),
      divulgacoes: itens.reduce((acc, p) => acc + p.meses[indice].divulgacoes, 0)
    };
  });
  return { meses, itens, totais };
}

module.exports = { listarConfiguracao, salvarConfiguracao, carregarPainel };
