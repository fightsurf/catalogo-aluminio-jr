/* AVN Dieta - barras de micronutrientes versus referência diária de adultos saudáveis.
   Referências: National Academies DRI / NIH Office of Dietary Supplements.
   RDA e AI são referências populacionais, não diagnóstico nem limite superior.
*/
(()=>{'use strict';
 const $=id=>document.getElementById(id);
 const API='/avn/sistema/api/nutricao/nutrientes';
 const URL_PERFIL='/api/avn/usuarios/';
 const base=(valor,tipo='RDA')=>({valor,tipo});
 const DRI={
  sodio_mg:()=>base(2300,'limite'),
  potassio_mg:p=>base(p.m?3400:2600,'AI'),
  calcio_mg:p=>base(p.age>70||(p.f&&p.age>50)?1200:1000),
  ferro_mg:p=>base(p.f&&p.age<=50?18:8),
  magnesio_mg:p=>base(p.m?(p.age<31?400:420):(p.age<31?310:320)),
  zinco_mg:p=>base(p.m?11:8),
  selenio_ug:()=>base(55),
  fosforo_mg:()=>base(700),
  cobre_mg:()=>base(0.9),
  manganes_mg:p=>base(p.m?2.3:1.8,'AI'),
  iodo_ug:()=>base(150),
  cloreto_mg:p=>base(p.age>70?1800:p.age>50?2000:2300,'AI'),
  cromo_ug:p=>base(p.m?(p.age>50?30:35):(p.age>50?20:25),'AI'),
  molibdenio_ug:()=>base(45),
  fluoreto_mg:p=>base(p.m?4:3,'AI'),
  vitamina_a_ug:p=>base(p.m?900:700),
  vitamina_b1_mg:p=>base(p.m?1.2:1.1),
  vitamina_b2_mg:p=>base(p.m?1.3:1.1),
  vitamina_b3_mg:p=>base(p.m?16:14),
  vitamina_b5_mg:()=>base(5,'AI'),
  vitamina_b6_mg:p=>base(p.age>50?(p.m?1.7:1.5):1.3),
  vitamina_b7_ug:()=>base(30,'AI'),
  folato_ug:()=>base(400),
  vitamina_b12_ug:()=>base(2.4),
  vitamina_c_mg:p=>base(p.m?90:75),
  vitamina_d_ug:p=>base(p.age>70?20:15),
  vitamina_e_mg:()=>base(15),
  vitamina_k_ug:p=>base(p.m?120:90,'AI'),
  colina_mg:p=>base(p.m?550:425,'AI'),
  ala_mg:p=>base(p.m?1600:1100,'AI')
 };
 // Retinol, K1/K2 e compostos bioativos não têm metas independentes; não somar duas vezes.
 const fmt=(n,places=1)=>Number(n).toLocaleString('pt-BR',{maximumFractionDigits:places});
 const clean=x=>String(x==null?'':x).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
 const profileCache=new Map();let cataloguePromise=null,token=0;
 function getJSON(url){
  return fetch(url,{credentials:'same-origin',cache:'no-store'}).then(async response=>{
   if(!response.ok)throw Error('Não foi possível consultar os parâmetros nutricionais.');
   const data=await response.json();
   if(data&&data.erro)throw Error(data.erro);
   return data;
  });
 }
 function catalogue(){
  if(!cataloguePromise){
   cataloguePromise=getJSON(API).then(data=>{
    if(!Array.isArray(data.micros))throw Error('Catálogo de nutrientes inválido.');
    return data.micros;
   }).catch(err=>{cataloguePromise=null;throw err;});
  }
  return cataloguePromise;
 }
 function profile(id){
  if(!profileCache.has(id)){
   profileCache.set(id,getJSON(URL_PERFIL+encodeURIComponent(id)).catch(err=>{
    profileCache.delete(id);throw err;
   }));
  }
  return profileCache.get(id);
 }
 function ageOf(iso){
  if(!/^\d{4}-\d{2}-\d{2}/.test(String(iso||'')))return null;
  const d=new Date(String(iso).slice(0,10)+'T12:00:00');
  if(Number.isNaN(d.getTime()))return null;
  const t=new Date();
  let years=t.getFullYear()-d.getFullYear();
  if(t.getMonth()<d.getMonth()||(t.getMonth()===d.getMonth()&&t.getDate()<d.getDate()))years--;
  return years>=0&&years<125?years:null;
 }
 function referenceProfile(user){
  const age=ageOf(user.data_nascimento),sex=user.sexo_referencia_calculo;
  if(age===null||age<19||!['masculino','feminino'].includes(sex))return null;
  return {age,m:sex==='masculino',f:sex==='feminino'};
 }
 function referenceLabel(p){
  return (p.m?'Homem':'Mulher')+' · '+p.age+' anos · referências para adulto saudável';
 }
 function valueFor(item,key){
  let comp=item.composicao_100g;
  if(typeof comp==='string'){try{comp=JSON.parse(comp);}catch(_){comp=null;}}
  let micronutrients=comp&&typeof comp==='object'?(comp.micros||comp.micronutrientes_100g):null;
  if(!micronutrients)micronutrients=item.micronutrientes_100g;
  if(typeof micronutrients==='string'){try{micronutrients=JSON.parse(micronutrients);}catch(_){micronutrients=null;}}
  const value=micronutrients?.[key];
  return value===null||value===undefined||value===''||!Number.isFinite(Number(value))||Number(value)<0?null:Number(value);
 }
 function compute(items,key){
  let amount=0,miss=0,found=0;
  for(const item of items){
   const grams=Number(item.quantidade_g);
   if(!Number.isFinite(grams)||grams<=0){miss++;continue;}
   const v=valueFor(item,key);
   if(v===null){miss++;continue;}
   found++;amount+=v*grams/100;
  }
  return {amount,miss,found,total:items.length};
 }
 function renderRow(n,item,p){
  const key=n.codigo,name=n.nome,unit=n.unidade;
  const calc=compute(item,key),ref=p&&DRI[key]?DRI[key](p):null;
  const valid=ref&&Number.isFinite(ref.valor)&&ref.valor>0;
  const ratio=valid&&calc.found?100*calc.amount/ref.valor:null;
  const width=ratio===null?0:Math.min(100,Math.max(0,ratio));
  const estimated=calc.found?fmt(calc.amount,calc.amount<1?3:1)+' '+unit:'Sem dado';
  const incomplete=calc.found>0&&calc.miss>0;
  const note=calc.total===0?'Sem alimentos na dieta':
      !calc.found?'Composição não informada nos alimentos':
      incomplete?'Parcial: '+calc.miss+' alimento(s) sem informação':'';
  const exceeds=ratio!==null&&ratio>100;
  const caption=valid?(ref.tipo==='limite'?'Limite de referência: ':'Referência '+ref.tipo+': ')+fmt(ref.valor,ref.valor<1?3:1)+' '+unit:
     'Sem referência diária comparável';
  const stateText=ratio===null?'':fmt(ratio,0)+'% da referência';
  const style=valid?'style="--micro-progress:'+width.toFixed(2)+'%;"':'';
  const classes='avn-micro-bar'+(!valid?' no-reference':'')+(ref?.tipo==='limite'?' is-limit':'')+(ref?.tipo==='limite'&&exceeds?' over-limit':'')+(calc.miss?' has-missing':'');
  return '<article class="avn-micro-ref-row">'+
    '<div class="avn-micro-ref-header"><strong>'+clean(name)+'</strong><span>'+clean(estimated)+'</span></div>'+
    '<div class="'+classes+'" '+style+' role="progressbar" aria-label="'+clean(name)+' — '+clean(caption)+'" '+
    (valid&&calc.found?'aria-valuemin="0" aria-valuemax="100" aria-valuenow="'+Math.min(100,Math.round(ratio))+'"':'aria-valuetext="'+clean(calc.found?'Sem referência':'Sem dados')+'"')+'><span class="avn-micro-ref-fill"></span></div>'+
    '<div class="avn-micro-ref-foot"><small>'+clean(caption)+'</small><small>'+clean(stateText)+'</small></div>'+
    (note?'<small class="avn-micro-ref-note">'+clean(note)+'</small>':'')+
    '</article>';
 }
 function renderList(catalogue,items,p){
  const cats=['Vitaminas','Minerais','Outros'];
  let html='<div class="avn-micro-ref-intro"><b>'+clean(p?referenceLabel(p):'Perfil sem referência adulta definida')+'</b>'+
   '<p>Barras: parte preenchida = quantidade <b>planejada</b>; parte vazia = parcela restante até a referência. '+
   'RDA = recomendação diária; AI = ingestão adequada estimada. Sódio usa um limite, não uma meta a atingir.</p></div>';
  for(const cat of cats){
   const list=catalogue.filter(n=>(n.categoria||'Outros')===cat);
   if(!list.length)continue;
   html+='<section class="avn-micro-ref-section"><h4>'+clean(cat==='Outros'?'Outros componentes':cat)+'</h4>';
   for(const n of list)html+=renderRow(n,items,p);
   html+='</section>';
  }
  html+='<p class="avn-micro-ref-disclaimer">Valores estimados a partir dos alimentos cadastrados. '+
   'Barra completa não indica dose ideal nem exclui excesso; acima de 100% não é automaticamente perigoso. '+
   'Dados ausentes não representam zero. Vitaminas e minerais exigem interpretação do tipo de referência e da unidade cadastrada. '+
   '<a href="https://ods.od.nih.gov/healthinformation/nutrientrecommendations.aspx" target="_blank" rel="noopener noreferrer">Fontes: NIH / National Academies (DRI)</a>.</p>';
  return html;
 }
 async function refresh(){
  const state=window.AVNNutricaoInterno?.state;
  const target=$('conteudoMicrosDieta');
  const modal=$('modalAnaliseDieta');
  if(!state||!target||!modal?.open)return;
  const id=String(state.usuarioId||'');
  const current=++token;
  if(!id){target.textContent='Selecione um usuário para analisar a dieta.';return;}
  const items=Array.isArray(state.dieta)?state.dieta.slice():[];
  target.textContent='Calculando consumo estimado e referências diárias…';
  try{
   const [list,user]=await Promise.all([catalogue(),profile(id)]);
   if(current!==token||!modal.open||String(state.usuarioId)!==id)return;
   target.innerHTML=renderList(list,items,referenceProfile(user));
  }catch(err){
   if(current===token)target.textContent='Falha ao carregar referências: '+(err.message||'erro desconhecido');
  }
 }
 function init(){
  const btn=$('abrirAnaliseDieta');
  const modal=$('modalAnaliseDieta');
  if(!btn||!modal)return;
  // A implementação original mantém as abas/macros e abre o modal normalmente.
  // Substituir somente o painel de micronutrientes após o evento principal.
  btn.addEventListener('click',()=>requestAnimationFrame(refresh));
  modal.addEventListener('close',()=>{token++;});
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});
 else init();
})();