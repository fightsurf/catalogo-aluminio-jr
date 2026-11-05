'use strict';
const pool = require('../../../db/connection');
const { erro, numero, inteiro } = require('./comprasValidator');
const STATUS = new Set(['a_confirmar','pendente','pago','cancelado']);
const TIPOS = new Set(['boleto','duplicata']);
function texto(v,max) {
  const s=String(v ?? '').trim();
  if(s.length>max) throw erro('Campo do boleto excede '+max+' caracteres.');
  return s || null;
}
function data(v,campo) {
  if(v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0,10);
  const s=String(v ?? '').trim();
  if(!s) return null;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw erro(campo+' inválida.');
  const d=new Date(s+'T12:00:00Z');
  if(Number.isNaN(d.getTime()) || d.toISOString().slice(0,10)!==s) throw erro(campo+' inválida.');
  return s;
}
function codigo(v,tamanho,campo) {
  const s=String(v??'').replace(/[\s.\-]/g,'');
  if(!s) return null;
  if(!/^\d+$/.test(s) || !(Array.isArray(tamanho)?tamanho:[tamanho]).includes(s.length))
    throw erro(campo+' inválido: confira os dígitos.');
  return s;
}
function validarBoleto(b={},indice=0,origem='manual') {
  if(!b || typeof b!=='object'||Array.isArray(b)) throw erro('Boleto '+(indice+1)+' inválido.');
  const tipo=String(b.tipo||'boleto').toLowerCase();
  if(!TIPOS.has(tipo)) throw erro('Tipo do boleto '+(indice+1)+' inválido.');
  const status=String(b.status||(tipo==='duplicata'?'a_confirmar':'pendente')).toLowerCase();
  if(!STATUS.has(status)) throw erro('Status do boleto '+(indice+1)+' inválido.');
  const vencimento=data(b.vencimento,'Vencimento do boleto '+(indice+1));
  if(!vencimento) throw erro('Informe o vencimento do boleto '+(indice+1)+'.');
  const valor=numero(b.valor,'Valor do boleto '+(indice+1),{minimo:0.01,maximo:999999999,casas:2});
  if(valor===null) throw erro('Informe o valor do boleto '+(indice+1)+'.');
  const id=inteiro(b.id,'Identificador do boleto '+(indice+1),Number.MAX_SAFE_INTEGER);
  const resultado={
    id,tipo,parcela:texto(b.parcela,30),numero_documento:texto(b.numero_documento,80),
    nosso_numero:texto(b.nosso_numero,80),banco:texto(b.banco,120),
    vencimento,valor,linha_digitavel:codigo(b.linha_digitavel,[47,48],'Linha digitável'),
    codigo_barras:codigo(b.codigo_barras,44,'Código de barras'),
    status,data_pagamento:status==='pago'?data(b.data_pagamento,'Data do pagamento'):null,
    valor_pago:status==='pago'?numero(b.valor_pago,'Valor pago',{minimo:0,maximo:999999999,casas:2}):null,
    observacao:texto(b.observacao,400),
    origem:origem==='ia'?'ia':(b.origem==='ia'?'ia':'manual')
  };
  return resultado;
}
function validarBoletos(lista,origem='manual'){
  if(!Array.isArray(lista))throw erro('Lista de boletos inválida.');
  if(lista.length>100)throw erro('Cada nota pode ter até 100 boletos.');
  return lista.map((b,i)=>validarBoleto(b,i,origem));
}
function dia(v){return data(v,'Vencimento');}
function iguais(a,b){
  if(a.linha_digitavel && b.linha_digitavel)
    return a.linha_digitavel===b.linha_digitavel;
  if(a.codigo_barras && b.codigo_barras)
    return a.codigo_barras===b.codigo_barras;
  if(dia(a.vencimento)!==dia(b.vencimento)||Number(a.valor)!==Number(b.valor)) return false;
  // Não mesclar parcelas distintas apenas porque vencem no mesmo dia e têm o mesmo valor.
  if(a.parcela&&b.parcela&&a.parcela.toLowerCase()!==b.parcela.toLowerCase())return false;
  if(a.numero_documento&&b.numero_documento&&a.numero_documento.toLowerCase()!==b.numero_documento.toLowerCase())return false;
  if(a.nosso_numero&&b.nosso_numero&&a.nosso_numero!==b.nosso_numero)return false;
  return true;
}
const CAMPOS='id,nota_id,tipo,parcela,numero_documento,nosso_numero,banco,vencimento,valor,linha_digitavel,codigo_barras,status,data_pagamento,valor_pago,observacao,origem';
async function listar(notaId){
  const {rows}=await pool.query('SELECT '+CAMPOS+' FROM public.compras_boletos WHERE nota_id=$1 ORDER BY vencimento,id',[notaId]);
  return rows;
}
async function sincronizar(cliente,notaId,lista){
  const boletos=validarBoletos(lista);
  const {rows:antigos}=await cliente.query('SELECT id FROM public.compras_boletos WHERE nota_id=$1 FOR UPDATE',[notaId]);
  const validos=new Set(antigos.map(x=>String(x.id)));
  const usados=new Set(),ids=[];
  for(const b of boletos){
    if(b.id){
      if(!validos.has(String(b.id))||usados.has(String(b.id)))throw erro('Boleto inexistente ou repetido nesta nota.');
      usados.add(String(b.id));
      await cliente.query(
        'UPDATE public.compras_boletos SET tipo=$3,parcela=$4,numero_documento=$5,nosso_numero=$6,banco=$7,vencimento=$8,valor=$9,linha_digitavel=$10,codigo_barras=$11,status=$12,data_pagamento=$13,valor_pago=$14,observacao=$15,atualizado_em=NOW() WHERE nota_id=$1 AND id=$2',
        [notaId,b.id,b.tipo,b.parcela,b.numero_documento,b.nosso_numero,b.banco,b.vencimento,b.valor,b.linha_digitavel,b.codigo_barras,b.status,b.data_pagamento,b.valor_pago,b.observacao]);
      ids.push(b.id);
    } else {
      const {rows:[novo]}=await cliente.query(
        'INSERT INTO public.compras_boletos (nota_id,tipo,parcela,numero_documento,nosso_numero,banco,vencimento,valor,linha_digitavel,codigo_barras,status,data_pagamento,valor_pago,observacao,origem) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id',
        [notaId,b.tipo,b.parcela,b.numero_documento,b.nosso_numero,b.banco,b.vencimento,b.valor,b.linha_digitavel,b.codigo_barras,b.status,b.data_pagamento,b.valor_pago,b.observacao,b.origem]);
      ids.push(novo.id);
    }
  }
  await cliente.query('DELETE FROM public.compras_boletos WHERE nota_id=$1 AND NOT (id = ANY($2::bigint[]))',[notaId,ids]);
}
async function importar(cliente,notaId,lista){
  const boletos=validarBoletos(lista,'ia');
  if(!boletos.length)return 0;
  const {rows:atuais}=await cliente.query('SELECT '+CAMPOS+' FROM public.compras_boletos WHERE nota_id=$1 FOR UPDATE',[notaId]);
  let adicionados=0;
  for(const b of boletos){
    const existente=atuais.find(a=>iguais(a,b));
    if(existente){
      // Só completar campos não preenchidos; nunca modificar pagamento, cancelamento ou valores lançados.
      await cliente.query(
        'UPDATE public.compras_boletos SET parcela=COALESCE(parcela,$2),numero_documento=COALESCE(numero_documento,$3),nosso_numero=COALESCE(nosso_numero,$4),banco=COALESCE(banco,$5),linha_digitavel=COALESCE(linha_digitavel,$6),codigo_barras=COALESCE(codigo_barras,$7),tipo=CASE WHEN tipo=\'duplicata\' AND $8=\'boleto\' THEN \'boleto\' ELSE tipo END,status=CASE WHEN status=\'a_confirmar\' AND $8=\'boleto\' THEN \'pendente\' ELSE status END,atualizado_em=NOW() WHERE id=$1',
        [existente.id,b.parcela,b.numero_documento,b.nosso_numero,b.banco,b.linha_digitavel,b.codigo_barras,b.tipo]);
    }else{
      const {rows:[novo]}=await cliente.query(
        'INSERT INTO public.compras_boletos (nota_id,tipo,parcela,numero_documento,nosso_numero,banco,vencimento,valor,linha_digitavel,codigo_barras,status,observacao,origem) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,\'ia\') RETURNING id',
        [notaId,b.tipo,b.parcela,b.numero_documento,b.nosso_numero,b.banco,b.vencimento,b.valor,b.linha_digitavel,b.codigo_barras,b.status,b.observacao]);
      atuais.push({...b,id:novo.id,nota_id:notaId});
      adicionados++;
    }
  }
  return adicionados;
}
async function consultar(filtros={}){
  const p=[],w=[];
  if(filtros.status){
    const status=String(filtros.status);
    if(!STATUS.has(status))throw erro('Filtro de status inválido.');
    p.push(status);w.push('b.status=$'+p.length);
  }
  if(filtros.busca){
    p.push('%'+String(filtros.busca).slice(0,80).trim()+'%');
    w.push('(n.numero_nf ILIKE $'+p.length+' OR f.nome ILIKE $'+p.length+' OR b.numero_documento ILIKE $'+p.length+')');
  }
  const sql='SELECT '+CAMPOS.split(',').map(c=>'b.'+c).join(',')+',n.numero_nf,f.nome AS fornecedor_nome, (b.vencimento<CURRENT_DATE AND b.status IN (\'a_confirmar\',\'pendente\')) AS atrasado FROM public.compras_boletos b JOIN public.compras_notas n ON n.id=b.nota_id JOIN public.fornecedores f ON f.id=n.fornecedor_id '+(w.length?'WHERE '+w.join(' AND '):'')+' ORDER BY CASE WHEN b.status IN (\'a_confirmar\',\'pendente\') THEN 0 ELSE 1 END,b.vencimento ASC,b.id DESC LIMIT 500';
  const {rows}=await pool.query(sql,p);return rows;
}
async function alterarStatus(id,dados={}){
  const boletoId=inteiro(id,'Identificador do boleto');
  const status=String(dados.status||'').toLowerCase();
  if(!STATUS.has(status))throw erro('Status inválido.');
  const data_pagamento=status==='pago'?data(dados.data_pagamento,'Data do pagamento'):null;
  const valor_pago=status==='pago'?numero(dados.valor_pago,'Valor pago',{minimo:0,maximo:999999999,casas:2}):null;
  const {rows:[atualizado]}=await pool.query(
    'UPDATE public.compras_boletos SET status=$2,data_pagamento=CASE WHEN $2=\'pago\' THEN COALESCE($3::date,CURRENT_DATE) ELSE NULL END,valor_pago=CASE WHEN $2=\'pago\' THEN COALESCE($4,valor) ELSE NULL END,atualizado_em=NOW() WHERE id=$1 RETURNING '+CAMPOS,
    [boletoId,status,data_pagamento,valor_pago]);
  if(!atualizado)throw erro('Boleto não encontrado.',404);
  return atualizado;
}
module.exports={validarBoleto,validarBoletos,iguais,listar,sincronizar,importar,consultar,alterarStatus};
