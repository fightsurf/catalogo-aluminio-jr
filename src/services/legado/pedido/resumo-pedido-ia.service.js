'use strict';
const pedidos = require('./pedidosLegado.service');
const MODELO = process.env.RESUMO_PEDIDO_IA_MODEL || 'gpt-4o-mini';
function erro(msg,status=400) { const e=new Error(msg); e.status=status; return e; }
function detectarTipo(itens) {
  if (!Array.isArray(itens)||itens.length<2) return 'orcamento';
  const ids=new Set(itens.map(x=>Number(x.item)).filter(x=>x>0));
  const preco=Number(itens[0].preco);
  return ids.size>=2&&Number.isFinite(preco)&&itens.every(x=>Math.abs(Number(x.preco)-preco)<0.01) ? 'kit-feirinha':'orcamento';
}
function moeda(x){return Number(x).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});}
function dataBR(data){
  const m=String(data||'').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if(!m)return '';
  const d=new Date(Date.UTC(+m[1],+m[2]-1,+m[3],12));
  return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===m[0]?m[3]+'/'+m[2]+'/'+m[1]:'';
}
function juntar(n){
  return n.length<=2?n.join(' e '):n.slice(0,-1).join(', ')+' e '+n[n.length-1];
}
// Panelas de pressão e antiaderentes são destaques obrigatórios quando presentes.
function prioridades(itens, sugestoes = []) {
  const descricao = item => String(item.descricao || '').toLowerCase();
  const panelaPressao = item => /panela.{0,50}press[aã]o/i.test(descricao(item));
  const antiaderente = item => /anti[ -]?aderente|teflon/i.test(descricao(item));
  const quantidade = item => Math.max(0, Number(item.quantidade) || 0);
  const ordenar = (a, b) => quantidade(itens[b]) - quantidade(itens[a])
    || quantidade(itens[b]) * Number(itens[b].preco || 0) - quantidade(itens[a]) * Number(itens[a].preco || 0);
  const todos = itens.map((_, i) => i);
  const resultado = [];
  const incluirPrimeiro = candidatos => {
    const i = candidatos.sort(ordenar).find(i => !resultado.includes(i));
    if (i !== undefined && resultado.length < 3) resultado.push(i);
  };
  incluirPrimeiro(todos.filter(i => panelaPressao(itens[i])));
  incluirPrimeiro(todos.filter(i => antiaderente(itens[i])));
  const sugeridos = new Set(sugestoes.filter(i => Number.isInteger(i) && i >= 0 && i < itens.length));
  const pontuacao = i => (panelaPressao(itens[i]) ? 3000 : 0)
    + (antiaderente(itens[i]) ? 2000 : 0)
    + (sugeridos.has(i) ? 100 : 0);
  const demais = todos.filter(i => !resultado.includes(i))
    .sort((a, b) => pontuacao(b) - pontuacao(a) || ordenar(a, b));
  return resultado.concat(demais).slice(0, 3);
}
function quantidadeFalavel(item) {
  const valor = Number(item.quantidade);
  const numero = valor.toLocaleString('pt-BR', {maximumFractionDigits: 2});
  return numero + (valor === 1 ? ' unidade de ' : ' unidades de ')
    + String(item.descricao || '').trim().slice(0, 100);
}
async function chamarIA(itens,tipo,contexto){
  const chave=String(process.env.OPENAI_API_KEY||'').trim();
  if(!chave)throw erro('Configure OPENAI_API_KEY no Render para usar o resumo com IA.',503);
  let response;
  try{
    response=await fetch('https://api.openai.com/v1/chat/completions',{
      method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+chave},
      signal:AbortSignal.timeout(30000),
      body:JSON.stringify({model:MODELO,temperature:0.3,max_tokens:100,response_format:{type:'json_object'},messages:[
        {role:'system',content:'Escolha até 3 índices dos produtos de maior destaque no pedido. Priorize panelas de pressão e itens antiaderentes e considere as quantidades. Responda APENAS JSON: {"indices":[0,2]}. Não escreva texto, preços, previsões ou informações inventadas. Use somente índices existentes.'},
        {role:'user',content:JSON.stringify({tipo,...contexto,itens:itens.map((x,i)=>({indice:i,descricao:x.descricao,quantidade:x.quantidade,preco:x.preco}))})}
      ]})
    });
  }catch(_){throw erro('Não foi possível conectar à IA.',502);}
  if(!response.ok)throw erro('A IA não conseguiu gerar o resumo. Confira a configuração.',502);
  try{return JSON.parse((await response.json()).choices[0].message.content);}
  catch(_){throw erro('A IA retornou um resumo inválido.',502);}
}
async function gerarResumo(id,tipoSolicitado='automatico'){
  if(!/^\d{1,14}$/.test(String(id||'')))throw erro('Identificador inválido.');
  if(!['automatico','kit-feirinha','orcamento'].includes(tipoSolicitado))throw erro('Tipo inválido.');
  const pedido=await pedidos.buscarDetalhePedido(id);
  if(!pedido)throw erro('Pedido não encontrado.',404);
  if(String(pedido.situacao||'').trim().toUpperCase()==='C')throw erro('Pedido cancelado não pode ser resumido.');
  const itens=(pedido.itens||[]).filter(x=>String(x.descricao||'').trim()&&Number(x.quantidade)>0);
  if(!itens.length)throw erro('Pedido sem itens válidos.');
  const tipoDetectado=detectarTipo(itens);
  const tipo=tipoSolicitado==='automatico'?tipoDetectado:tipoSolicitado;
  const quantidade=itens.reduce((s,x)=>s+Number(x.quantidade),0);
  const total=Number(pedido.total);
  if(!Number.isFinite(total)||total<0||!quantidade)throw erro('Total ou quantidade inválida no pedido.',422);
  const cliente=String(pedido.cliente?.nome||'cliente').trim().slice(0,100)||'cliente';
  const carrada=pedido.carradaAtual||(await pedidos.buscarItensPedido(id))?.carradaAtual;
  const previsao=dataBR(carrada?.data);
  const gerado=await chamarIA(itens,tipo,{cliente,total,dataPrevisao:previsao||null,precoMedio:tipo==='kit-feirinha'?Number((total/quantidade).toFixed(2)):null});
  const indices = (Array.isArray(gerado.indices) ? gerado.indices : [])
    .filter(i => Number.isInteger(i) && i >= 0 && i < itens.length);
  const nomes = prioridades(itens, indices).map(i => quantidadeFalavel(itens[i]));
  const texto = [
    'Olá, ' + cliente + '! Seu pedido foi registrado com sucesso.',
    tipo === 'kit-feirinha'
      ? 'Seu Kit Feirinha ficou muito bom! Destaque para ' + juntar(nomes) + '. O preço médio por peça ficou em ' + moeda(total / quantidade) + '.'
      : 'Destaque para ' + juntar(nomes) + '.',
    'O valor total do pedido é ' + moeda(total) + '.',
    previsao ? 'A previsão de finalização é para o dia ' + previsao + '.' : 'A previsão de finalização ainda não foi informada.'
  ].join(' ');
  if(texto.length>1000)throw erro('O texto ultrapassou o limite de áudio.',422);
  return {texto,cliente,pedidoNumero:pedido.numero,telefone:pedido.cliente?.telefonePrincipal||'',
    tipo,tipoDetectado,total,precoMedio:tipo==='kit-feirinha'?Number((total/quantidade).toFixed(2)):null,
    dataPrevisao:previsao||null,produtosDestacados:nomes,
    observacao:previsao?null:'Sem data de carrada cadastrada; a previsão não foi inventada.'};
}
module.exports={gerarResumo,detectarTipo,dataBR,prioridades};
