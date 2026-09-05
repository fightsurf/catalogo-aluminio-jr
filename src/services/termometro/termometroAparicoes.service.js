const pool = require('../../../db/connection');
const schemaService = require('./termometroSchema.service');

function texto(valor) {
  return String(valor ?? '').trim();
}

function inteiroPositivo(valor, fallback = 1) {
  const numero = Number.parseInt(valor, 10);
  return Number.isInteger(numero) && numero > 0 ? numero : fallback;
}

function canaisPublicados(canais = {}) {
  return Object.entries(canais)
    .filter(([, valor]) => valor?.status === 'publicado')
    .map(([canal]) => canal);
}


async function prepararEstrutura() {
  await schemaService.criarEstrutura();
}

async function inserirAparicao({
  produtoId,
  origem,
  origemChave,
  origemId = null,
  quantidade = 1,
  publicadoEm = new Date(),
  detalhes = {}
}) {
  await schemaService.criarEstrutura();

  const result = await pool.query(`
    INSERT INTO termometro_aparicoes
      (produto_id, origem, origem_chave, origem_id, quantidade, publicado_em, detalhes)
    VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
    ON CONFLICT (origem, origem_chave, produto_id) DO NOTHING
    RETURNING id
  `, [
    Number(produtoId),
    texto(origem),
    texto(origemChave),
    origemId === null || origemId === undefined ? null : Number(origemId),
    inteiroPositivo(quantidade),
    publicadoEm,
    JSON.stringify(detalhes || {})
  ]);

  return Boolean(result.rows.length);
}

async function registrarStatusZap({ requestId, produto, canais }) {
  const chave = texto(requestId);
  if (!chave || !produto?.id) return false;

  const publicados = canaisPublicados(canais);
  if (!publicados.length) return false;

  return inserirAparicao({
    produtoId: produto.id,
    origem: 'status_zap',
    origemChave: chave,
    quantidade: 1,
    detalhes: {
      produto_nome: produto.nome || null,
      categoria_id: produto.categoria_id || null,
      categoria: produto.categoria || null,
      canais_publicados: publicados
    }
  });
}

async function registrarCentralOfertas({ chavePublicacao, oferta, canais }) {
  if (!oferta?.id || !Array.isArray(oferta.itens) || !oferta.itens.length) return 0;

  const publicados = canaisPublicados(canais);
  if (!publicados.length) return 0;

  await schemaService.criarEstrutura();
  const chave = texto(chavePublicacao);
  if (!chave) throw new Error('Chave da publicação da Central de Ofertas não informada.');

  let inseridos = 0;
  for (const item of oferta.itens) {
    if (!item?.produto_id) continue;

    const inseriu = await inserirAparicao({
      produtoId: item.produto_id,
      origem: 'central_ofertas',
      origemChave: chave,
      origemId: oferta.id,
      quantidade: inteiroPositivo(item.quantidade),
      detalhes: {
        oferta_id: oferta.id,
        codigo_oferta: oferta.codigo || null,
        titulo_oferta: oferta.titulo || null,
        produto_nome: item.nome || null,
        canais_publicados: publicados
      }
    });

    if (inseriu) inseridos += 1;
  }

  return inseridos;
}

module.exports = {
  prepararEstrutura,
  inserirAparicao,
  registrarStatusZap,
  registrarCentralOfertas
};
