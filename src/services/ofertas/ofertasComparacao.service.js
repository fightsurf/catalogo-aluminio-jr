const crypto = require('crypto');
const pool = require('../../../db/connection');

function assinatura(itens) {
  const quantidades = new Map();
  for (const item of itens) {
    if (!item.produto_id) throw new Error('Kit com produto sem identificação. Revise os itens.');
    const id = String(item.produto_id);
    quantidades.set(id, (quantidades.get(id) || 0) + Number(item.quantidade));
  }
  return [...quantidades].sort((a, b) => Number(a[0]) - Number(b[0]));
}

function retrato(oferta) {
  return {
    id: oferta.id, codigo: oferta.codigo, total: oferta.total,
    preco_medio: oferta.preco_medio, total_itens: oferta.total_itens,
    itens: oferta.itens.map(({ produto_id, nome, quantidade, preco_unitario }) =>
      ({ produto_id, nome, quantidade, preco_unitario })),
  };
}

async function verificar(oferta, confirmacao) {
  const atual = retrato(oferta);
  const { rows: anteriores } = await pool.query(
    `SELECT id, oferta_id, publicado_em, dados, legado
     FROM ofertas_publicacoes_historico WHERE assinatura=$1::jsonb
     ORDER BY publicado_em DESC, id DESC`, [JSON.stringify(assinatura(oferta.itens))]);
  if (!anteriores.length) return null;
  // Uma alteração de preços ou uma nova publicação exige nova comparação.
  const token = crypto.createHash('sha256')
    .update(JSON.stringify({ atual, anteriores })).digest('hex');
  if (confirmacao === token) return null;
  return { requer_confirmacao: true, atual, anteriores, confirmacao: token };
}

async function registrar(oferta) {
  await pool.query(
    `INSERT INTO ofertas_publicacoes_historico (oferta_id, assinatura, dados)
     VALUES ($1, $2::jsonb, $3::jsonb)`,
    [oferta.id, JSON.stringify(assinatura(oferta.itens)), JSON.stringify(retrato(oferta))]);
}

module.exports = { assinatura, retrato, verificar, registrar };
