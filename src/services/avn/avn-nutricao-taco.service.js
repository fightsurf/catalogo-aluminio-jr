'use strict';
// TACO 4a ed. NEPA/UNICAMP, JSON estruturado independente (brolesi/taco).
// Dados por 100 g de parte comestível. A fonte NÃO é API oficial da Unicamp.
const ORIGIN='https://brolesi.github.io/taco';
const INDEX=ORIGIN+'/foods.json';
const TIMEOUT=9000, CACHE_MS=12*60*60*1000;
let indexCache=null, indexTime=0, pending=null;
function text(s){return String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();}
async function json(url){
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),TIMEOUT);
 try{const response=await fetch(url,{signal:controller.signal,headers:{accept:'application/json'}});
  if(!response.ok)throw Object.assign(new Error('Fonte TACO indisponível ('+response.status+').'),{status:502});
  return await response.json();
 }finally{clearTimeout(timer);}
}
async function index(){
 if(indexCache&&Date.now()-indexTime<CACHE_MS)return indexCache;
 if(!pending)pending=json(INDEX).then(data=>{
   const list=Array.isArray(data)?data:Array.isArray(data?.foods)?data.foods:null;
   if(!list||list.length<500)throw Object.assign(new Error('Índice TACO incompleto.'),{status:502});
   const safe=list.filter(x=>Number.isInteger(Number(x.id))&&Number(x.id)>0&&Number(x.id)<=597&&typeof x.description==='string');
   if(safe.length<500)throw Object.assign(new Error('Índice TACO inválido.'),{status:502});
   indexCache=safe;indexTime=Date.now();return safe;
  }).finally(()=>pending=null);
 return pending;
}
function searchIndex(items,term){
 const query=text(term),words=query.split(' ').filter(Boolean);
 return items.map(x=>{
   const d=text(x.description);let score=d===query?200:d.startsWith(query)?100:d.includes(query)?70:0;
   const matching=words.filter(w=>d.includes(w)).length;
   if(!score&&matching!==words.length)return null;
   score+=matching*10;
   return {x,score};
 }).filter(Boolean).sort((a,b)=>b.score-a.score||a.x.description.localeCompare(b.x.description,'pt-BR')).slice(0,25);
}
async function search(term){
 const items=await index();return {pesquisa:term,fonte:'taco',opcoes:searchIndex(items,term).map(({x})=>({
  fdcId:'taco-'+x.id, descricao:x.description, tipo:'TACO · Brasil',marca:'',fonte:'taco',preparo:x.preparation||''
 }))};
}
const num=v=>{if(v==null||v===''||typeof v==='boolean')return null;
 const n=Number(v);return Number.isFinite(n)&&n>=0?n:null;};
const FIELD_MAP={
 sodium_mg:'sodio_mg',potassium_mg:'potassio_mg',calcium_mg:'calcio_mg',iron_mg:'ferro_mg',magnesium_mg:'magnesio_mg',zinc_mg:'zinco_mg',
 phosphorus_mg:'fosforo_mg',copper_mg:'cobre_mg',manganese_mg:'manganes_mg',
 thiamine_mg:'vitamina_b1_mg',riboflavin_mg:'vitamina_b2_mg',niacin_mg:'vitamina_b3_mg',pyridoxine_mg:'vitamina_b6_mg',vitamin_c_mg:'vitamina_c_mg',
 retinol_mcg:'retinol_ug',rae_mcg:'vitamina_a_ug',cholesterol_mg:'colesterol_mg',moisture_pct:'agua_g',
 saturated_g:'gordura_saturada_g',monounsaturated_g:'gordura_monoinsaturada_g',polyunsaturated_g:'gordura_poliinsaturada_g'
};
function composition(raw,catalogue){
 const food=raw?.food||raw?.data||raw;
 if(!food||typeof food!=='object'||Array.isArray(food))throw Object.assign(new Error('Composição TACO inválida.'),{status:502});
 const macros={kcal:num(food.energy_kcal),proteinas_g:num(food.protein_g),carboidratos_g:num(food.carbohydrate_g),gorduras_g:num(food.lipids_g),fibras_g:num(food.dietary_fiber_g)};
 const allowed=new Set(catalogue.map(x=>x.codigo));const micros={};
 for(const [source,target] of Object.entries(FIELD_MAP)){
  const value=num(food[source]);if(allowed.has(target)&&value!==null)micros[target]=value;
 }
 // Não mistura vitamina A RE, RAE e retinol (unidades representam conceitos diferentes).
 return {descricao:String(food.description||''),marca:'',preparo:String(food.preparation||''),tipo:'TACO · NEPA/UNICAMP',fonte:'taco',
  fonteUrl:ORIGIN+'/foods/'+Number(food.id)+'.json',tacoId:Number(food.id),
  macros,micros,nota:'Dados TACO, 4ª edição (NEPA/UNICAMP), por 100 g da parte comestível. Valores ausentes não são zero. API JSON independente: brolesi/taco.'};
}
async function detail(id,catalogue){
 if(!/^\d{1,3}$/.test(String(id))||Number(id)<1||Number(id)>597)throw Object.assign(new Error('ID TACO inválido.'),{status:400});
 const items=await index();const found=items.find(x=>Number(x.id)===Number(id));if(!found)throw Object.assign(new Error('Alimento não encontrado na TACO.'),{status:404});
 const data=await json(ORIGIN+'/foods/'+id+'.json');const normalized=composition(data,catalogue);
 normalized.descricao=found.description;normalized.preparo=found.preparation||normalized.preparo;
 return normalized;
}
module.exports={search,detail,composition,searchIndex,FIELD_MAP};
