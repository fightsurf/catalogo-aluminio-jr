'use strict';
// Entidades são declaradas no código. Ações são registros configuráveis, sem SQL livre.
const pool = require('../../../db/connection');
const pagamentos = require('../legado/pagamentos/pagamentos.service');
const pedidos = require('../legado/pedidos-cliente/pedidos-cliente.service');

const ENTIDADES = Object.freeze({
  clientes: {
    nome:'Clientes', filtros:[{id:'nome_informado',nome:'Nome informado na conversa'}],
    ordenacoes:[{id:'nome_asc',nome:'Nome (A–Z)'}],
    campos:[
      {id:'favorecido',nome:'Código',tipo:'numero'},
      {id:'nome',nome:'Nome',tipo:'texto'},
      {id:'cidade',nome:'Cidade',tipo:'texto'},
      {id:'uf',nome:'Estado',tipo:'texto'},
      {id:'telefone',nome:'Telefone',tipo:'telefone'}
    ]
  },
  pedidos: {
    nome:'Pedidos', filtros:[{id:'cliente_selecionado',nome:'Cliente selecionado na conversa'}],
    ordenacoes:[{id:'data_desc',nome:'Mais recentes primeiro'},{id:'data_asc',nome:'Mais antigos primeiro'}],
    campos:[
      {id:'numero',nome:'Número',tipo:'texto'},
      {id:'data',nome:'Data',tipo:'data'},
      {id:'total',nome:'Valor total',tipo:'moeda'},
      {id:'situacao',nome:'Situação',tipo:'texto'},
      {id:'totalPago',nome:'Total pago',tipo:'moeda'},
      {id:'saldoRestante',nome:'Saldo restante',tipo:'moeda'}
    ]
  }
});

let preparando;
async function preparar() {
  if (!preparando) preparando = pool.query([
    'CREATE TABLE IF NOT EXISTS whatsapp_admin_acoes (',
    'id BIGSERIAL PRIMARY KEY, nome VARCHAR(120) NOT NULL,',
    'entidade VARCHAR(40) NOT NULL, filtro VARCHAR(40) NOT NULL,',
    'campos JSONB NOT NULL DEFAULT \'[]\'::jsonb,',
    'ordenacao VARCHAR(40) NOT NULL, limite INTEGER NOT NULL DEFAULT 5,',
    'cabecalho TEXT NOT NULL DEFAULT \'\', item TEXT NOT NULL,',
    'vazio TEXT NOT NULL DEFAULT \'Nenhum resultado encontrado.\',',
    'ativo BOOLEAN NOT NULL DEFAULT TRUE,',
    'criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(), atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW())'
  ].join(' ')).catch(e => { preparando = null; throw e; });
  await preparando;
}
function validacao(d) {
  const nome = String(d?.nome || '').trim();
  const entidade = String(d?.entidade || '');
  const def = ENTIDADES[entidade];
  if (nome.length < 3 || nome.length > 120) throw Error('Nome da ação deve ter de 3 a 120 caracteres.');
  if (!def) throw Error('Entidade indisponível.');
  const filtro = String(d?.filtro || '');
  const ordenacao = String(d?.ordenacao || '');
  if (!def.filtros.some(x => x.id === filtro)) throw Error('Filtro não permitido para a entidade.');
  if (!def.ordenacoes.some(x => x.id === ordenacao)) throw Error('Ordenação não permitida para a entidade.');
  const limite = Number(d?.limite);
  if (!Number.isInteger(limite) || limite < 1 || limite > 10) throw Error('Limite permitido: de 1 a 10 resultados.');
  const campos = d?.campos;
  if (!Array.isArray(campos) || !campos.length || campos.length > def.campos.length ||
    campos.some(x => typeof x !== 'string' || !def.campos.some(y => y.id === x)) ||
    new Set(campos).size !== campos.length) throw Error('Escolha campos válidos da entidade.');
  const cabecalho = String(d?.cabecalho || '').trim();
  const item = String(d?.item || '').trim();
  const vazio = String(d?.vazio || '').trim();
  if (cabecalho.length > 900 || item.length < 3 || item.length > 1500 || vazio.length > 400) {
    throw Error('Modelo de mensagem inválido (cabeçalho até 900, item entre 3 e 1500, vazio até 400 caracteres).');
  }
  const permitidas = new Set([...campos,'indice','cliente.nome','termo','quantidade']);
  for (const modelo of [cabecalho,item,vazio]) {
    for (const match of modelo.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)) {
      if (!permitidas.has(match[1].trim())) throw Error('Campo não autorizado no modelo: ' + match[1]);
    }
    if (/\{\{|\}\}/.test(modelo.replace(/\{\{\s*[^{}]+\s*\}\}/g,''))) {
      throw Error('Use campos no formato {{nome}}.');
    }
  }
  return {nome,entidade,filtro,campos,ordenacao,limite,cabecalho,item,vazio,ativo:d?.ativo !== false};
}
async function listar() {
  await preparar();
  const r = await pool.query('SELECT * FROM whatsapp_admin_acoes ORDER BY id ASC');
  return r.rows;
}
async function obter(id) {
  await preparar();
  const r = await pool.query('SELECT * FROM whatsapp_admin_acoes WHERE id=$1',[id]);
  return r.rows[0] || null;
}
async function cadastrar(d) {
  const v=validacao(d); await preparar();
  const r=await pool.query(
    'INSERT INTO whatsapp_admin_acoes (nome,entidade,filtro,campos,ordenacao,limite,cabecalho,item,vazio,ativo) VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10) RETURNING *',
    [v.nome,v.entidade,v.filtro,JSON.stringify(v.campos),v.ordenacao,v.limite,v.cabecalho,v.item,v.vazio,v.ativo]);
  return r.rows[0];
}
async function atualizar(id,d) {
  const v=validacao(d); await preparar();
  const r=await pool.query(
    'UPDATE whatsapp_admin_acoes SET nome=$2,entidade=$3,filtro=$4,campos=$5::jsonb,ordenacao=$6,limite=$7,cabecalho=$8,item=$9,vazio=$10,ativo=$11,atualizado_em=NOW() WHERE id=$1 RETURNING *',
    [id,v.nome,v.entidade,v.filtro,JSON.stringify(v.campos),v.ordenacao,v.limite,v.cabecalho,v.item,v.vazio,v.ativo]);
  if (!r.rows.length) throw Error('Ação não encontrada.');
  return r.rows[0];
}
async function excluir(id) {
  await preparar();
  const vinculos = await pool.query('SELECT COUNT(*)::int AS total FROM whatsapp_admin_intencoes WHERE acao_id=$1',[id]);
  if (vinculos.rows[0]?.total) throw Error('Ação vinculada a intenções. Desvincule antes de excluir.');
  const r=await pool.query('DELETE FROM whatsapp_admin_acoes WHERE id=$1 RETURNING id',[id]);
  if (!r.rows.length) throw Error('Ação não encontrada.');
  return true;
}
function dataChave(v) {
  const s=String(v || '');
  const m=s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return Number(m[1]+m[2]+m[3]);
  const n=s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  return n ? Number(n[3]+n[2]+n[1]) : 0;
}
function exibir(v,tipo) {
  if (v === null || v === undefined || v === '') return 'Não informado';
  if (tipo === 'moeda') {
    const numero=Number(v);
    return Number.isFinite(numero) ? numero.toLocaleString('pt-BR',{style:'currency',currency:'BRL'}) : 'Não informado';
  }
  if (tipo === 'data') {
    const s=String(v); const m=s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? m[3]+'/'+m[2]+'/'+m[1] : s.slice(0,30);
  }
  if (tipo === 'telefone') {
    const s=String(v).replace(/\D/g,'');
    if (s.length === 11) return '('+s.slice(0,2)+') '+s.slice(2,7)+'-'+s.slice(7);
    if (s.length === 10) return '('+s.slice(0,2)+') '+s.slice(2,6)+'-'+s.slice(6);
  }
  return String(v).replace(/[\r\n]/g,' ').replace(/[{}]/g,'').slice(0,180);
}
function formatar(modelo, valores) {
  return String(modelo || '').replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_m,k)=>String(valores[k.trim()] ?? ''));
}
async function executar(acao,contexto={},deps={}) {
  if (!acao || !acao.ativo) throw Error('Ação não está ativa.');
  const v=validacao(acao);
  let dados=[];
  if (v.entidade === 'clientes') {
    const nome=String(contexto.termo || '').trim();
    if (nome.length < 2 || nome.length > 100) throw Error('Informe um nome de cliente com pelo menos 2 caracteres.');
    const buscar=deps.listarClientes || pagamentos.listarClientes;
    const r=await buscar(nome);
    dados=(Array.isArray(r)?r:[]).map(c=>({...c,telefone:c.telefonePrincipal||c.telefone1||c.telefone||''}));
    dados.sort((a,b)=>String(a.nome||'').localeCompare(String(b.nome||''),'pt-BR'));
  } else if (v.entidade === 'pedidos') {
    const id=Number(contexto.cliente?.favorecido);
    if (!Number.isSafeInteger(id)||id<=0) throw Error('Primeiro localize e selecione um cliente.');
    const buscar=deps.listarPedidosPorCliente || pedidos.listarPedidosPorCliente;
    const r=await buscar(id);
    dados=Array.isArray(r?.dados)?r.dados:[];
    dados.sort((a,b)=>(dataChave(b.data)-dataChave(a.data) || Number(b.numero||0)-Number(a.numero||0))*(v.ordenacao==='data_asc'?-1:1));
  }
  const escolhidos=dados.slice(0,v.limite);
  const meta={termo:String(contexto.termo||''), 'cliente.nome':String(contexto.cliente?.nome||''),quantidade:String(escolhidos.length)};
  const tipos=Object.fromEntries(ENTIDADES[v.entidade].campos.map(c=>[c.id,c.tipo]));
  const linhas=escolhidos.map((registro,indice)=>{
    const valores={...meta,indice:String(indice+1)};
    for(const campo of v.campos) valores[campo]=exibir(registro[campo],tipos[campo]);
    return formatar(v.item,valores);
  });
  const mensagem=escolhidos.length
    ? [formatar(v.cabecalho,meta),...linhas].filter(Boolean).join('\n\n').slice(0,12000)
    : formatar(v.vazio || 'Nenhum resultado encontrado.',meta);
  return {mensagem,registros:escolhidos,entidade:v.entidade};
}
module.exports={ENTIDADES,validacao,preparar,listar,obter,cadastrar,atualizar,excluir,executar};
