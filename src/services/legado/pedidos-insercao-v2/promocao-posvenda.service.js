'use strict';
const pool = require('../../../../db/connection');
const custoService = require('../../produtoResumoCusto/produtoResumoCusto.service');
const pedidos = require('../pedido/pedidosLegado.service');
const zapi = require('../../integracoes/zapi.service');

let preparacao, iniciado = false;
function erro(msg, status = 400) { const e = new Error(msg); e.status = status; return e; }
async function preparar() {
  if (!preparacao) preparacao = pool.query([
    'CREATE TABLE IF NOT EXISTS pedido_promocoes_posvenda (',
    'id BIGSERIAL PRIMARY KEY, pedido_ref BIGINT NOT NULL UNIQUE, pedido_numero TEXT NOT NULL,',
    'cliente_nome TEXT NOT NULL, telefone TEXT NOT NULL, produto_id BIGINT NOT NULL,',
    'produto_nome TEXT NOT NULL, preco_tabela NUMERIC(14,2) NOT NULL,',
    'custo_atual NUMERIC(14,4) NOT NULL, preco_promocional NUMERIC(14,2) NOT NULL,',
    'imagem TEXT NOT NULL, mensagem TEXT NOT NULL,',
    "status TEXT NOT NULL DEFAULT 'pendente', criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),",
    'enviar_em TIMESTAMPTZ NOT NULL, iniciado_em TIMESTAMPTZ,',
    'imagem_aceita_em TIMESTAMPTZ,',
    'enviado_em TIMESTAMPTZ, atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(), erro TEXT',
    ');'
  ].join(' ')).catch(e => { preparacao = null; throw e; });
  return preparacao;
}
function moeda(n) { return Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
function numeroPositivo(v, nome) {
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n <= 0) throw erro(nome + ' inválido.');
  return n;
}
function telefoneValido(valor) {
  let n = zapi.normalizarTelefone(valor);
  if (/^\d{10,11}$/.test(n)) n = '55' + n;
  if (!/^55\d{10,11}$/.test(n)) throw erro('O cadastro do cliente não possui WhatsApp válido.');
  return n;
}
function fotoPublica(valor) {
  const foto = String(valor || '').trim();
  if (/^data:image\/(png|jpe?g|webp);base64,[a-z0-9+/=]+$/i.test(foto) && foto.length <= 2800000) return foto;
  const origem = String(process.env.PUBLIC_BASE_URL || 'https://catalogo-aluminio-jr.onrender.com').replace(/\/+$/, '');
  let url;
  try { url = new URL(foto, origem + '/'); } catch (_) { throw erro('O produto está sem foto válida para enviar.'); }
  if (!foto || url.protocol !== 'https:' || url.username || url.password ||
      /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.|.*\.(local|internal)$)/i.test(url.hostname)) {
    throw erro('O produto está sem foto pública HTTPS válida.');
  }
  return url.href;
}
async function listarProdutos(busca = '') {
  const [{ produtos }, fotos] = await Promise.all([
    custoService.listar({ ativos: 'true' }),
    pool.query('SELECT id, foto, foto_2, foto_3 FROM produtos WHERE ativo=TRUE')
  ]);
  const mapa = new Map(fotos.rows.map(p => [Number(p.id), p]));
  const termo = String(busca || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().slice(0, 80);
  return produtos.filter(p => p.produto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().includes(termo))
    .map(p => ({
      id: p.produto_id, nome: p.produto, preco: p.preco_venda, custo: p.custo,
      semCusto: p.custo_zerado, foto: [mapa.get(p.produto_id)?.foto, mapa.get(p.produto_id)?.foto_2, mapa.get(p.produto_id)?.foto_3].find(Boolean) || null
    }));
}
async function textoIA({ cliente, produto, preco }) {
  const key = String(process.env.OPENAI_API_KEY || '').trim();
  if (!key) throw erro('Configure OPENAI_API_KEY no Render.', 503);
  const base = 'Cliente: ' + cliente + '. Produto: ' + produto + '. Preço promocional: ' + moeda(preco) + '.';
  let resposta;
  try {
    resposta = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST', signal: AbortSignal.timeout(25000),
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.PROMO_POSVENDA_MODELO_IA || 'gpt-4o-mini',
        temperature: 0.6, max_tokens: 155,
        messages: [
          { role: 'system', content: 'Você é vendedor da fábrica Alumínio JR. Escreva em português do Brasil UMA mensagem de WhatsApp natural e curta, de 2 frases e até 250 caracteres, para oferecer UM produto depois de uma compra. Use apenas os dados fornecidos. Cite nome do cliente e produto, e convide a responder caso queira acrescentar ao pedido. NÃO escreva preços ou valores monetários, pois o sistema acrescentará o preço promocional em linha separada. Não invente estoque, urgência, desconto percentual, detalhes técnicos nem condições. Não use aspas nem emojis.' },
          { role: 'user', content: base }
        ]
      })
    });
  } catch (_) { throw erro('Falha de conexão com a IA. A promoção não foi agendada.', 502); }
  const body = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw erro('A IA não conseguiu preparar a mensagem. A promoção não foi agendada.', 502);
  const texto = String(body.choices?.[0]?.message?.content || '').trim().replace(/\s+/g, ' ');
  if (texto.length < 20 || texto.length > 400) throw erro('A IA retornou uma mensagem inválida. Nenhuma promoção foi agendada.', 502);
  return texto;
}
async function agendar(dados) {
  await preparar();
  const pedidoRef = numeroPositivo(dados?.pedidoId, 'Pedido');
  const produtoId = numeroPositivo(dados?.produtoId, 'Produto');
  const preco = Number(dados?.precoPromocional);
  if (!Number.isFinite(preco) || preco <= 0 || preco > 999999 || Math.round(preco * 100) / 100 !== preco) throw erro('Informe um preço promocional positivo, com no máximo duas casas decimais.');
  if (dados?.autorizadoWhatsApp !== true) throw erro('Confirme que o cliente autorizou receber ofertas pelo WhatsApp.');
  const jaExiste = await pool.query('SELECT id FROM pedido_promocoes_posvenda WHERE pedido_ref=$1', [pedidoRef]);
  if (jaExiste.rowCount) throw erro('Já existe uma oferta programada para este pedido.', 409);
  const [detalhe, itens] = await Promise.all([
    pedidos.buscarDetalhePedido(pedidoRef), listarProdutos('')
  ]);
  if (!detalhe?.idMestre || Number(detalhe.idMestre) !== pedidoRef) throw erro('Pedido não encontrado no sistema legado.', 404);
  const produto = itens.find(p => p.id === produtoId);
  if (!produto) throw erro('Produto não encontrado ou inativo.');
  if (!(Number(produto.preco) > preco)) throw erro('O preço promocional deve ser menor que o preço atual do produto.');
  if (produto.semCusto) throw erro('Produto sem custo de composição válido. Revise o custo antes de agendar a promoção.');
  const dadosFoto = await pool.query('SELECT foto, foto_2, foto_3 FROM produtos WHERE id=$1 AND ativo=TRUE', [produtoId]);
  const imagem = fotoPublica([dadosFoto.rows[0]?.foto, dadosFoto.rows[0]?.foto_2, dadosFoto.rows[0]?.foto_3].find(Boolean));
  const nomeCliente = String(detalhe.cliente?.nome || '').trim();
  if (!nomeCliente) throw erro('Cliente sem nome no cadastro.');
  const telefone = telefoneValido(detalhe.cliente?.telefonePrincipal);
  const tabelaBloqueio = await pool.query("SELECT to_regclass('public.mala_direta_bloqueios') AS tabela");
  if (tabelaBloqueio.rows[0]?.tabela) {
    const bloqueado = await pool.query('SELECT 1 FROM mala_direta_bloqueios WHERE telefone=$1', [telefone]);
    if (bloqueado.rowCount) throw erro('Cliente bloqueou o recebimento de promoções.', 409);
  }
  const textoPromocional = await textoIA({ cliente: nomeCliente.split(/\s+/)[0], produto: produto.nome, preco });
  const mensagem = textoPromocional + '\nPreço promocional: ' + moeda(preco);
  const salvoEmMs = Date.parse(String(dados?.pedidoSalvoEm || ''));
  const agora = Date.now();
  const inicio = Number.isFinite(salvoEmMs) && salvoEmMs <= agora && salvoEmMs >= agora - 20 * 60000 ? salvoEmMs : agora;
  const horario = new Date(inicio + 60 * 60000);
  try {
    const salvo = await pool.query([
      'INSERT INTO pedido_promocoes_posvenda',
      '(pedido_ref,pedido_numero,cliente_nome,telefone,produto_id,produto_nome,preco_tabela,custo_atual,preco_promocional,imagem,mensagem,enviar_em)',
      'VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
      'RETURNING id, enviar_em'
    ].join(' '), [
      pedidoRef, String(detalhe.numero || pedidoRef), nomeCliente, telefone, produtoId, produto.nome,
      produto.preco, produto.custo, preco, imagem, mensagem, horario
    ]);
    return { id: salvo.rows[0].id, enviarEm: salvo.rows[0].enviar_em, mensagem, produto: produto.nome, precoPromocional: preco };
  } catch (e) { if (e.code === '23505') throw erro('Já existe uma oferta programada para este pedido.', 409); throw e; }
}
async function processarProximo() {
  await preparar();
  await pool.query([
    "UPDATE pedido_promocoes_posvenda SET status='incerto',",
    "erro='Envio interrompido: verificar WhatsApp antes de repetir', atualizado_em=NOW()",
    "WHERE status='enviando' AND atualizado_em < NOW() - INTERVAL '3 minutes'"
  ].join(' '));
  const achado = await pool.query([
    'WITH proximo AS (SELECT id FROM pedido_promocoes_posvenda',
    "WHERE status='pendente' AND enviar_em <= NOW() ORDER BY enviar_em,id",
    'LIMIT 1 FOR UPDATE SKIP LOCKED)',
    "UPDATE pedido_promocoes_posvenda p SET status='enviando',",
    'iniciado_em=NOW(), atualizado_em=NOW() FROM proximo',
    'WHERE p.id=proximo.id RETURNING p.*'
  ].join(' '));
  if (!achado.rowCount) return;
  const p = achado.rows[0];
  try {
    const check = await pool.query("SELECT to_regclass('public.mala_direta_bloqueios') AS tabela");
    if (check.rows[0]?.tabela) {
      const bloqueado = await pool.query('SELECT 1 FROM mala_direta_bloqueios WHERE telefone=$1', [p.telefone]);
      if (bloqueado.rowCount) {
        await pool.query("UPDATE pedido_promocoes_posvenda SET status='bloqueado',erro='Cliente bloqueado para promoções',atualizado_em=NOW() WHERE id=$1", [p.id]);
        return;
      }
    }
    await zapi.enviarImagem({ telefone: p.telefone, imagem: p.imagem, legenda: p.mensagem }, { timeoutMs: 60000 });
    await pool.query("UPDATE pedido_promocoes_posvenda SET status='enviado',imagem_aceita_em=NOW(),enviado_em=NOW(),atualizado_em=NOW() WHERE id=$1", [p.id]);
  } catch (e) {
    console.error('[promocao-posvenda] Envio incerto do pedido', p.pedido_ref, e.message);
    await pool.query("UPDATE pedido_promocoes_posvenda SET status='incerto', erro=$2, atualizado_em=NOW() WHERE id=$1 AND status='enviando'", [p.id, String(e.message).slice(0, 800)]).catch(e2 => console.error('[promocao-posvenda] Falha ao registrar:', e2.message));
  }
}
function iniciarTrabalhador() {
  if (iniciado) return;
  iniciado = true;
  async function tick() {
    try { await processarProximo(); } catch (e) { console.error('[promocao-posvenda/worker]', e.message); }
    finally { const t = setTimeout(tick, 30000); t.unref?.(); }
  }
  const t = setTimeout(tick, 8000);
  t.unref?.();
}
module.exports = { listarProdutos, agendar, iniciarTrabalhador, preparar };
