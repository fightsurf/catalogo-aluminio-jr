const crypto = require('crypto');
const pool = require('../../../db/connection');
const produtoService = require('../produto/produto.service');
const schemaService = require('./ofertasSchema.service');
const arteOfertaService = require('./arteOferta.service');
const cloudflareR2Service = require('../cloudflare/cloudflareR2.service');
const zapiService = require('../integracoes/zapi.service');

function numeroPositivo(valor, nome) {
  const numero = Number(valor);
  if (!Number.isFinite(numero) || numero <= 0) throw new Error(`${nome} inválido.`);
  return numero;
}

function inteiroPositivo(valor, nome) {
  const numero = Number.parseInt(valor, 10);
  if (!Number.isInteger(numero) || numero <= 0) throw new Error(`${nome} inválida.`);
  return numero;
}

function corHex(valor, nome) {
  const texto = String(valor || '').trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(texto)) throw new Error(`${nome} inválida.`);
  return texto.toUpperCase();
}

function normalizarTemaArte(payload = {}) {
  const temas = new Set([...Object.keys(arteOfertaService.TEMAS || {}), 'personalizado']);
  const tema = String(payload.tema_arte || 'claro').trim().toLowerCase();
  if (!temas.has(tema)) throw new Error('Tema da arte inválido.');

  if (tema !== 'personalizado') {
    return { tema_arte: tema, cores_arte: {} };
  }

  const cores = payload.cores_arte && typeof payload.cores_arte === 'object' ? payload.cores_arte : {};
  return {
    tema_arte: 'personalizado',
    cores_arte: {
      fundoInicio: corHex(cores.fundoInicio, 'Cor inicial do fundo'),
      fundoFim: corHex(cores.fundoFim, 'Cor final do fundo'),
      destaque: corHex(cores.destaque, 'Cor de destaque'),
      texto: corHex(cores.texto, 'Cor do texto'),
    },
  };
}

function codigoOferta() {
  const data = new Date().toISOString().slice(0,10).replace(/-/g,'');
  return `OF-${data}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

function normalizarOferta(row, itens=[]) {
  return {
    ...row,
    id: Number(row.id),
    total: Number(row.total),
    preco_medio: Number(row.preco_medio),
    total_itens: Number(row.total_itens),
    visualizacoes: Number(row.visualizacoes || 0),
    cliques_whatsapp: Number(row.cliques_whatsapp || 0),
    tema_arte: row.tema_arte || 'claro',
    cores_arte: row.cores_arte && typeof row.cores_arte === 'object' ? row.cores_arte : {},
    itens: itens.map(i => ({ ...i, id:Number(i.id), produto_id:i.produto_id?Number(i.produto_id):null, quantidade:Number(i.quantidade), preco_unitario:Number(i.preco_unitario), preco_medio:Number(i.preco_medio) })),
  };
}

async function obterItens(ofertaId) {
  const result = await pool.query('SELECT * FROM ofertas_itens WHERE oferta_id = $1 ORDER BY id ASC', [ofertaId]);
  return result.rows;
}

async function buscarPorId(id) {
  await schemaService.criarEstrutura();
  const result = await pool.query('SELECT * FROM ofertas WHERE id = $1', [id]);
  if (!result.rows.length) throw new Error('Oferta não encontrada.');
  return normalizarOferta(result.rows[0], await obterItens(id));
}

async function buscarPorCodigo(codigo, registrarVisualizacao=false) {
  await schemaService.criarEstrutura();
  const result = await pool.query('SELECT * FROM ofertas WHERE codigo = $1', [codigo]);
  if (!result.rows.length) throw new Error('Oferta não encontrada.');
  let row = result.rows[0];
  if (registrarVisualizacao) {
    const atualizado = await pool.query('UPDATE ofertas SET visualizacoes = visualizacoes + 1 WHERE id = $1 RETURNING *', [row.id]);
    row = atualizado.rows[0];
  }
  return normalizarOferta(row, await obterItens(row.id));
}

async function listar() {
  await schemaService.criarEstrutura();
  const result = await pool.query('SELECT * FROM ofertas ORDER BY created_at DESC LIMIT 100');
  return Promise.all(result.rows.map(async row => normalizarOferta(row, await obterItens(row.id))));
}

async function criar(payload) {
  await schemaService.criarEstrutura();
  const itensEntrada = Array.isArray(payload.itens) ? payload.itens : [];
  if (!itensEntrada.length) throw new Error('Selecione ao menos um produto.');

  const produtos = await produtoService.listar({ perfil:'kit-feirinha', apenasAtivos:true });
  const mapa = new Map(produtos.map(p => [String(p.id), p]));
  const itens = itensEntrada.map(item => {
    const produto = mapa.get(String(item.produto_id));
    if (!produto) throw new Error(`Produto ${item.produto_id} não está disponível para Kit Feirinha.`);
    const quantidade = inteiroPositivo(item.quantidade, 'Quantidade');
    const preco = numeroPositivo(produto.preco, 'Preço');
    return { produto_id:Number(produto.id), nome:produto.nome, quantidade, preco_unitario:preco, foto_url:produto.foto || produto.fotos?.find(Boolean) || null };
  });
  const totalItens = itens.reduce((s,i)=>s+i.quantidade,0);
  if (totalItens > arteOfertaService.MAX_ITENS) {
    throw new Error(`Selecione no máximo ${arteOfertaService.MAX_ITENS} peças no total para a arte.`);
  }
  const total = itens.reduce((s,i)=>s+i.preco_unitario*i.quantidade,0);
  const precoMedio = total/totalItens;
  const titulo = String(payload.titulo || 'Kit Feirinha Especial').trim().slice(0,160) || 'Kit Feirinha Especial';
  const expiraEm = payload.expira_em ? new Date(payload.expira_em) : null;
  if (expiraEm && Number.isNaN(expiraEm.getTime())) throw new Error('Data de expiração inválida.');
  const { tema_arte, cores_arte } = normalizarTemaArte(payload);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ofertaResult = await client.query(`INSERT INTO ofertas (codigo,titulo,total,preco_medio,total_itens,expira_em,prompt_cenario,tema_arte,cores_arte) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb) RETURNING *`, [codigoOferta(),titulo,total,precoMedio,totalItens,expiraEm,payload.prompt_cenario || null,tema_arte,JSON.stringify(cores_arte)]);
    const oferta = ofertaResult.rows[0];
    for (const item of itens) {
      await client.query(`INSERT INTO ofertas_itens (oferta_id,produto_id,nome,quantidade,preco_unitario,preco_medio,foto_url) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [oferta.id,item.produto_id,item.nome,item.quantidade,item.preco_unitario,precoMedio,item.foto_url]);
    }
    await client.query('COMMIT');
    return buscarPorId(oferta.id);
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

async function gerarArte(id) {
  const oferta = await buscarPorId(id);
  const buffer = await arteOfertaService.gerarArte(oferta);
  const upload = await cloudflareR2Service.uploadBuffer(buffer, {
    pasta:'ofertas', nome:`${oferta.codigo}.jpg`, contentType:'image/jpeg', metadata:{ oferta_id:String(oferta.id), codigo:oferta.codigo }
  });
  await pool.query(`UPDATE ofertas SET imagem_url=$1,r2_key=$2,status='arte_pronta',updated_at=NOW() WHERE id=$3`, [upload.url,upload.key,oferta.id]);
  return buscarPorId(id);
}

function basePublica(baseUrl) {
  return String(process.env.APP_PUBLIC_URL || baseUrl || '').replace(/\/+$/,'');
}

async function publicar(id, baseUrl) {
  const oferta = await buscarPorId(id);
  if (!oferta.imagem_url) throw new Error('Gere a arte antes de publicar.');
  const link = `${basePublica(baseUrl)}/ofertas/${encodeURIComponent(oferta.codigo)}`;
  // A arte já contém a chamada "CLIQUE NO LINK ABAIXO". No Status, a legenda deve conter somente o link público.
  const legenda = link;
  const envio = await zapiService.enviarImagemStatus({ imagem:oferta.imagem_url, legenda });
  await pool.query(`UPDATE ofertas SET status='publicada',publicado_em=NOW(),updated_at=NOW() WHERE id=$1`, [id]);
  return { oferta:await buscarPorId(id), link, legenda, zapi:envio.zapi };
}

async function duplicar(id) {
  const original = await buscarPorId(id);
  return criar({ titulo:`${original.titulo} - cópia`, itens:original.itens.map(i=>({produto_id:i.produto_id,quantidade:i.quantidade})), prompt_cenario:original.prompt_cenario, expira_em:original.expira_em, tema_arte:original.tema_arte, cores_arte:original.cores_arte });
}

async function registrarClique(codigo) {
  await schemaService.criarEstrutura();
  await pool.query('UPDATE ofertas SET cliques_whatsapp=cliques_whatsapp+1 WHERE codigo=$1', [codigo]);
  return { ok:true };
}

module.exports = { listar, criar, buscarPorId, buscarPorCodigo, gerarArte, publicar, duplicar, registrarClique };
