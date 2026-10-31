'use strict';

const { AsyncLocalStorage } = require('node:async_hooks');
const pool = require('../../../db/connection');
const contexto = new AsyncLocalStorage();

// Inventário dos pontos de saída identificados no backend e nos frontends.
// Todos os switches começam ligados para preservar o comportamento existente.
const CATALOGO = Object.freeze([
  ['envios_geral','Controle geral de envios','Bloqueia qualquer disparo da Z-API pelo Node, inclusive jobs automáticos.','Geral','Todas as telas'],
  ['pedidos_entrada_carrada','Pedido entrou na carrada','Aviso ao cliente ao inserir pedido ou incluir em uma carrada.','Pedidos','Inserção de pedidos / carradas'],
  ['pedidos_saida_carrada','Pedido saiu da carrada','Aviso ao retirar ou transferir pedido de carrada.','Pedidos','Inserção de pedidos / carradas'],
  ['pedidos_texto','Enviar texto do pedido','Botão "Enviar para WhatsApp" no pedido, em telas web e mobile.','Pedidos','Inserção e consulta de pedidos'],
  ['pedidos_historico_financeiro','Mensagens financeiras do cliente','Envio do saldo e histórico de pagamentos do cliente.','Pedidos','Pedidos do cliente'],
  ['pagamentos_mensagens','Mensagens dos pagamentos','Envios manuais relacionados a pagamentos no legado.','Financeiro','Pagamentos (web e mobile)'],
  ['progresso_mensagem_cliente','Mensagem manual no progresso','Botão de mensagem ao cliente no progresso da carrada.','Produção','Carradas / progresso'],
  ['pedidos_pdf','Enviar pedido em PDF','Botão de envio do PDF do pedido ao cliente.','Pedidos','Consulta e inserção de pedidos'],
  ['pedidos_fotos','Fotos dos produtos do pedido','Envio das fotos dos itens ao WhatsApp do cliente.','Pedidos','Relatório de fotos / inserção de pedidos'],
  ['pedidos_fotos_finalizacao','Resumo das fotos do pedido','Mensagem de encerramento e resumo do envio das fotos.','Pedidos','Relatório de fotos'],
  ['pedidos_resumo_imagem','Resumo de pedidos do cliente','Imagem de resumo de pedidos enviada pelo histórico do cliente.','Pedidos','Pedidos do cliente'],
  ['carradas_lote','Avisos em lote por carrada','Envio da lista de pedidos de uma carrada.','Logística','Carradas / Progresso'],
  ['semanas_lote','Avisos em lote por semana','Envio dos pedidos agrupados por semana.','Logística','Semanas'],
  ['fornecedores_semanas','WhatsApp dos fornecedores','Mensagens do resumo semanal para fornecedores.','Logística','Semanas / fornecedores'],
  ['progresso_producao','Entrou em produção','Aviso de início de produção e alterações de fase.','Produção','Progresso da carrada'],
  ['progresso_nota_fiscal','Nota fiscal do pedido','Aviso relacionado à solicitação de nota fiscal.','Produção','Progresso da carrada'],
  ['progresso_etiqueta','Etiqueta do pedido','Envio de etiquetas ou imagens de impressão ao WhatsApp.','Produção','Progresso / expedição'],
  ['progresso_local_entrega','Local de entrega e transporte','Avisos sobre transportadora, redespacho, agência e local de entrega.','Produção','Progresso / logística'],
  ['prestacoes_resumo','Resumo de prestação de contas','Mensagem com resumo de prestação de contas.','Financeiro','Prestação de contas'],
  ['prestacoes_pdf','PDF de prestação de contas','Envio do documento PDF da prestação de contas.','Financeiro','Prestação de contas'],
  ['mala_direta','Mala direta e campanhas','Disparos de fotos, textos e áudios de campanhas, inclusive fila automática.','Marketing','Mala direta'],
  ['promocao_posvenda','Promoção após salvar pedido','Oferta enviada após o pedido pelo trabalhador de pós-venda.','Marketing','Inserção de pedidos / promoções'],
  ['ofertas_kits','Comandos de kits','Envios gerados pelos comandos de kits da Central de Ofertas.','Marketing','Central de ofertas / integração'],
  ['ofertas_whatsapp','Oferta enviada ao contato','Envio manual de arte de oferta para um número.','Marketing','Central de ofertas'],
  ['status_whatsapp','Publicações no Status','Fotos e vídeos publicados no Status do WhatsApp, incluindo agendamentos.','Marketing','Status / funil de publicações'],
  ['bot_atendimento','Atendimento automático e manual','Respostas e ações de atendimento via Z-API.','Atendimento','Bot / intenções'],
  ['envio_manual','Envio manual genérico','Envio avulso de texto, imagem e arquivos pela API compartilhada.','Atendimento','WhatsApp / API de envio'],
  ['mirian_pacientes','Mensagens do projeto Mirian','Envios de WhatsApp aos pacientes.','Outros sistemas','Mirian'],
  ['outros_envios','Outras integrações Node','Protege qualquer disparo não associado a um módulo conhecido.','Outros sistemas','Serviços e integrações não classificados']
].map(([id,titulo,descricao,grupo,origem])=>({id,titulo,descricao,grupo,origem})));

const POR_ID = new Map(CATALOGO.map(item=>[item.id,item]));
let inicializando, cache = { expira: 0, estados: null };

async function preparar() {
  if (!inicializando) {
    inicializando = (async()=>{
      await pool.query(`CREATE TABLE IF NOT EXISTS whatsapp_central_controles (
        id TEXT PRIMARY KEY,
        ativo BOOLEAN NOT NULL DEFAULT TRUE,
        atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        atualizado_por TEXT
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS whatsapp_central_auditoria (
        id BIGSERIAL PRIMARY KEY, funcionalidade TEXT NOT NULL,
        ativo_anterior BOOLEAN NOT NULL, ativo_novo BOOLEAN NOT NULL,
        usuario TEXT, criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
      for (const item of CATALOGO) {
        await pool.query('INSERT INTO whatsapp_central_controles (id) VALUES ($1) ON CONFLICT DO NOTHING',[item.id]);
      }
    })().catch(e=>{ inicializando=null; throw e; });
  }
  await inicializando;
}

async function estados({semCache=false}={}) {
  if (!semCache && cache.estados && Date.now() < cache.expira) return cache.estados;
  await preparar();
  const linhas=(await pool.query('SELECT id, ativo, atualizado_em, atualizado_por FROM whatsapp_central_controles')).rows;
  const mapa=Object.fromEntries(linhas.map(item=>[item.id,item]));
  cache={estados:mapa,expira:Date.now()+3000};
  return mapa;
}

async function listar() {
  const mapa=await estados({semCache:true});
  return CATALOGO.map(item=>({...item, ativo:mapa[item.id]?.ativo===true,
    atualizado_em:mapa[item.id]?.atualizado_em||null, atualizado_por:mapa[item.id]?.atualizado_por||null}));
}

async function alterar(id, ativo, usuario) {
  if (!POR_ID.has(id)) { const e=new Error('Funcionalidade não encontrada.');e.status=404;throw e; }
  if (typeof ativo!=='boolean') { const e=new Error('Informe ativo como true ou false.');e.status=400;throw e; }
  await preparar();
  const db=await pool.connect();
  try {
    await db.query('BEGIN');
    const anterior=(await db.query('SELECT ativo FROM whatsapp_central_controles WHERE id=$1 FOR UPDATE',[id])).rows[0];
    if (!anterior) throw new Error('Controle não encontrado no banco.');
    await db.query('UPDATE whatsapp_central_controles SET ativo=$2,atualizado_em=NOW(),atualizado_por=$3 WHERE id=$1',
      [id,ativo,String(usuario||'admin').slice(0,120)]);
    if (anterior.ativo!==ativo) await db.query(`INSERT INTO whatsapp_central_auditoria
      (funcionalidade, ativo_anterior, ativo_novo, usuario) VALUES ($1,$2,$3,$4)`,
      [id,anterior.ativo,ativo,String(usuario||'admin').slice(0,120)]);
    await db.query('COMMIT');
    cache={expira:0,estados:null};
    return {id,ativo};
  } catch(e){await db.query('ROLLBACK').catch(()=>{});throw e;}finally{db.release();}
}

function classificarRequisicao(req) {
  const metodo=String(req.method||'').toUpperCase();
  if (!['POST','PATCH','PUT','DELETE'].includes(metodo)) return null;
  const url=String(req.originalUrl||req.url||'').split('?')[0].toLowerCase();
  if (url === '/api/whatsapp/enviar-pedido') return 'pedidos_texto';
  if (url === '/api/whatsapp/enviar-cliente-financeiro') return 'pedidos_historico_financeiro';
  if (url === '/api/whatsapp/enviar-pagamento') return 'pagamentos_mensagens';
  if (url === '/api/whatsapp/enviar-progresso') return 'progresso_mensagem_cliente';
  if (/\/api\/legado\/pedidos\/[^/]+\/whatsapp\/pdf/.test(url)) return 'pedidos_pdf';
  if (url.startsWith('/api/whatsapp/relatorio-fotos/')) {
    return url.endsWith('/finalizar')?'pedidos_fotos_finalizacao':'pedidos_fotos';
  }
  if (/\/api\/legado\/pedidos-cliente\/.*\/whatsapp\/resumo-imagem/.test(url)) return 'pedidos_resumo_imagem';
  if (url.includes('/api/legado/pedidos-insercao')) return 'pedidos_entrada_carrada';
  if (/\/api\/legado\/pedidos\/.*\/carrada/.test(url)||url.includes('/api/legado/carradas/')) return 'pedidos_entrada_carrada';
  if (url.startsWith('/api/legado/carradas-progresso/')) {
    if (url.includes('/whatsapp/lote')) return 'carradas_lote';
    if (url.includes('nota-fiscal')||url.includes('quer_nota_fiscal')) return 'progresso_nota_fiscal';
    if (url.includes('/producao/')||url.includes('em_producao')) return 'progresso_producao';
    if (url.includes('/etiqueta-')) return 'progresso_etiqueta';
    if (url.includes('/local-entrega')) return 'progresso_local_entrega';
    return 'progresso_producao';
  }
  if (url.startsWith('/api/legado/semanas/')) return url.includes('/fornecedores/')?'fornecedores_semanas':'semanas_lote';
  if (url.startsWith('/api/prestacoes')) return url.includes('pdf')?'prestacoes_pdf':'prestacoes_resumo';
  if (url.includes('/api/whatsapp/mala-direta')) return 'mala_direta';
  if (url.includes('/promocao-posvenda')) return 'promocao_posvenda';
  if (url.startsWith('/api/ofertas/')) return url.includes('kits-whatsapp')?'ofertas_kits':'ofertas_whatsapp';
  if (url.includes('/status-videos')||url.includes('/status-whatsapp')||url.includes('/api/whatsapp/status')) return 'status_whatsapp';
  if (url.startsWith('/mirian/')) return 'mirian_pacientes';
  if (url.startsWith('/bot/')) return 'bot_atendimento';
  if (url.startsWith('/api/whatsapp/')) return 'envio_manual';
  return null;
}

function middleware(req,res,next) {
  contexto.run({funcionalidade:classificarRequisicao(req)},next);
}

function atual() {return contexto.getStore()?.funcionalidade||null;}
function comFuncionalidade(funcionalidade,fn) {
  if (!POR_ID.has(funcionalidade)) throw new Error('Controle WhatsApp desconhecido: '+funcionalidade);
  return contexto.run({funcionalidade},fn);
}
async function verificar(funcionalidade) {
  const id=funcionalidade||atual()||'outros_envios';
  if (!POR_ID.has(id)) throw new Error('Controle WhatsApp desconhecido: '+id);
  const mapa=await estados();
  for (const chave of ['envios_geral',id]) {
    if (mapa[chave]?.ativo!==true) {
      const erro=new Error('Envio de WhatsApp desativado na Central de Controle: '+POR_ID.get(chave).titulo);
      erro.status=409;erro.codigo='WHATSAPP_ENVIO_DESATIVADO';erro.funcionalidade=chave;
      throw erro;
    }
  }
  return true;
}
async function ativo(id) {
  const mapa=await estados();
  return mapa.envios_geral?.ativo===true && mapa[id]?.ativo===true;
}
module.exports={CATALOGO,preparar,listar,alterar,middleware,classificarRequisicao,comFuncionalidade,verificar,ativo,atual};
