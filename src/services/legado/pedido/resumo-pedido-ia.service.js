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
function frase(valor){
  const s=String(valor||'').trim().replace(/\s+/g,' ');
  return s.length>0&&s.length<=110&&!/[\dR$]|reais|amanh[aã]|prazo|entrega|desconto|frete|gr[aá]tis|garanti/i.test(s)?s:'';
}
function juntar(n){
  return n.length<=2?n.join(' e '):n.slice(0,-1).join(', ')+' e '+n[n.length-1];
}
function prioridades(itens){
  const pontuar=x=>{
    const nome=String(x.descricao).toLowerCase();
    return (/panela.{0,8}press[aã]o/.test(nome)?100000:/cafeteira/.test(nome)?90000:/frigideira/.test(nome)?80000:0)
      +Math.max(0,Number(x.quantidade)||0)*Math.max(0,Number(x.preco)||0);
  };
  return itens.map((_,i)=>i).sort((a,b)=>pontuar(itens[b])-pontuar(itens[a])).slice(0,3);
}
async function chamarIA(itens,tipo){
  const chave=String(process.env.OPENAI_API_KEY||'').trim();
  if(!chave)throw erro('Configure OPENAI_API_KEY no Render para usar o resumo com IA.',503);
  let response;
  try{
    response=await fetch('https://api.openai.com/v1/chat/completions',{
      method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+chave},
      signal:AbortSignal.timeout(30000),
      body:JSON.stringify({model:MODELO,temperature:0.6,max_tokens:220,response_format:{type:'json_object'},messages:[
        {role:'system',content:'Você é um vendedor da Alumínio JR. Responda só JSON com indices (array com até 3 índices de itens relevantes), abertura e despedida (duas frases simpáticas curtas). Exemplos: {"indices":[0,2],"abertura":"Que bom receber seu pedido!","despedida":"Obrigado pela confiança na Alumínio JR!"}. Não mencione nos textos fatos, produtos, números, datas, prazos, descontos ou promessas. Use exclusivamente índices existentes nos dados.'},
        {role:'user',content:JSON.stringify({tipo,itens:itens.map((x,i)=>({indice:i,descricao:x.descricao,quantidade:x.quantidade,preco:x.preco})).slice(0,150)})}
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
  const gerado=await chamarIA(itens,tipo);
  const indices=[];
  for(const i of Array.isArray(gerado.indices)?gerado.indices:[]){
    if(Number.isInteger(i)&&i>=0&&i<itens.length&&!indices.includes(i))indices.push(i);
    if(indices.length>=3)break;
  }
  const nomes=(indices.length?indices:prioridades(itens)).map(i=>String(itens[i].descricao).trim().slice(0,120));
  const cliente=String(pedido.cliente?.nome||'cliente').trim().slice(0,100)||'cliente';
  const previsao=dataBR(pedido.carradaAtual?.data);
  const abertura=frase(gerado.abertura)||'Seu pedido foi registrado com sucesso!';
  const despedida=frase(gerado.despedida)||'A Alumínio JR agradece pela confiança!';
  const texto=['Olá, '+cliente+'! '+abertura+' Seu pedido reúne '+new Set(itens.map(x=>String(x.descricao||'').trim().toLowerCase())).size+' tipos de produtos.',
    tipo==='kit-feirinha'?'Seu Kit Feirinha ficou muito bom! Destaque para '+juntar(nomes)+'. O preço médio por peça ficou em '+moeda(total/quantidade)+'.':'Entre os produtos escolhidos, destaco '+juntar(nomes)+'.',
    'O valor total do pedido é '+moeda(total)+'.',
    previsao?'A previsão de finalização é para o dia '+previsao+'.':'A previsão de finalização ainda não foi informada.',
    despedida].join(' ');
  if(texto.length>1000)throw erro('O texto ultrapassou o limite de áudio.',422);
  return {texto,cliente,pedidoNumero:pedido.numero,telefone:pedido.cliente?.telefonePrincipal||'',
    tipo,tipoDetectado,total,precoMedio:tipo==='kit-feirinha'?Number((total/quantidade).toFixed(2)):null,
    dataPrevisao:previsao||null,produtosDestacados:nomes,
    observacao:previsao?null:'Sem data de carrada cadastrada; a previsão não foi inventada.'};
}
module.exports={gerarResumo,detectarTipo,dataBR,prioridades};
