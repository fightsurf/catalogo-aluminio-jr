'use strict';
const erro = (mensagem, status=400) => Object.assign(new Error(mensagem), {status});
const id = value => /^\d+$/.test(String(value || '')) && Number(value)>0 && Number.isSafeInteger(Number(value));
const texto = (v, limite, obrigatorio=false) => {
  const out = String(v ?? '').trim();
  if (out.length>limite || (obrigatorio && !out)) throw erro(`Texto inválido (máximo ${limite} caracteres).`);
  return out;
};
const inteiro = (v,min,max,label) => {
  const n=Number(v);
  if(!Number.isInteger(n)||n<min||n>max)throw erro(`${label} deve ser inteiro entre ${min} e ${max}.`);
  return n;
};
const carga = (v) => {
  if(v===null||v===undefined||v==='')return null;
  const n=Number(v);
  if(!Number.isFinite(n)||n<0||n>2000)return (()=>{throw erro('Carga inválida.');})();
  return Math.round(n*100)/100;
};
function midiaUrl(value){
  if(value==null||String(value).trim()==='')return null;
  const input=texto(value,2048,true);
  // Mídias locais da biblioteca oficial: aceita PNG (v1.0.0) ou SVG (versões posteriores).
  if(/^\/avn\/sistema\/midias\/[a-z0-9-]+\/frame-[123]\.(?:png|svg)$/.test(input))return input;
  let url;try{url=new URL(input);}catch(_){throw erro('URL da mídia inválida.');}
  if(url.protocol!=='https:'||url.username||url.password||!url.hostname||/\s/.test(input))throw erro('Use URL HTTPS pública e sem credenciais.');
  return url.toString();
}
function exercicio(body){
  if(!id(body.grupo_id))throw erro('Selecione um grupo muscular.');
  const tipo=texto(body.midia_tipo||'imagem',12);
  if(!['imagem','gif','video'].includes(tipo))throw erro('Tipo de mídia inválido.');
  return {nome:texto(body.nome,160,true),grupo_id:Number(body.grupo_id),equipamento:texto(body.equipamento||'Livre',100,true),instrucoes:texto(body.instrucoes,5000),midia_url:midiaUrl(body.midia_url),midia_tipo:tipo};
}
function itensExercicio(itens, realizados=false){
  if(!Array.isArray(itens)||itens.length>50)throw erro('Máximo de 50 exercícios por dia.');
  return itens.map((p,index)=>{
    if(!p || !id(p.exercicio_id))throw erro('Exercício inválido.');
    const unidade=p.carga_unidade??'kg';
    if(!['kg','placas'].includes(unidade))throw erro('Unidade de carga inválida.');
    const placas=p.carga_placas==null||p.carga_placas===''?null:inteiro(p.carga_placas,0,200,'Placas');
    if(unidade==='placas'&&p.carga_kg!=null&&p.carga_kg!=='')throw erro('Informe placas sem quilogramas.');
    if(unidade==='kg'&&placas!==null)throw erro('Informe kg sem placas.');
    const base={exercicio_id:Number(p.exercicio_id),posicao:index,carga_unidade:unidade,
      carga_kg:unidade==='kg'?carga(p.carga_kg):null,carga_placas:unidade==='placas'?placas:null,observacoes:texto(p.observacoes,500)};
    if(realizados)return {...base,series_realizadas:inteiro(p.series_realizadas,0,30,'Séries realizadas'),repeticoes_realizadas:texto(p.repeticoes_realizadas,30)};
    return {...base,series:inteiro(p.series,1,30,'Séries'),repeticoes:texto(p.repeticoes,30,true),descanso_seg:inteiro(p.descanso_seg,0,3600,'Descanso')};
  });
}
function plano(body){
  if(!id(body.usuario_id))throw erro('Usuário inválido.');
  if(!Array.isArray(body.dias)||body.dias.length>7)throw erro('Informe até sete dias.');
  const vistos=new Set();
  const dias=body.dias.map(d=>{
    const dia_semana=inteiro(d.dia_semana,0,6,'Dia');
    if(vistos.has(dia_semana))throw erro('Dia repetido.');vistos.add(dia_semana);
    return {dia_semana,itens:itensExercicio(d.exercicios||[])};
  });
  return {usuario_id:Number(body.usuario_id),nome:texto(body.nome,160,true),descricao:texto(body.descricao,4000),dias};
}
function sessao(body){
  if(!id(body.usuario_id)||!id(body.plano_id))throw erro('Usuário/plano inválido.');
  return {usuario_id:Number(body.usuario_id),plano_id:Number(body.plano_id),dia_semana:inteiro(body.dia_semana,0,6,'Dia'),observacoes:texto(body.observacoes,1000),realizados:itensExercicio(body.realizados,true)};
}
module.exports={erro,id,inteiro,texto,carga,midiaUrl,exercicio,plano,sessao};
