'use strict';
// AVN: dados nutricionais reais, exclusivamente provenientes do FoodData Central.
// OPENAI_API_KEY: opcional, só reformula a pesquisa; USDA_API_KEY: necessária para consultar.
const API='https://api.nal.usda.gov/fdc/v1';
const {traduzirTitulos}=require('./avn-nutricao-traducao.service');
const mapping={
  1093:'sodio_mg',1092:'potassio_mg',1087:'calcio_mg',1089:'ferro_mg',1090:'magnesio_mg',1095:'zinco_mg',1103:'selenio_ug',1091:'fosforo_mg',1098:'cobre_mg',1101:'manganes_mg',
  1106:'vitamina_a_ug',1165:'vitamina_b1_mg',1166:'vitamina_b2_mg',1167:'vitamina_b3_mg',1170:'vitamina_b5_mg',1175:'vitamina_b6_mg',1177:'folato_ug',1178:'vitamina_b12_ug',1162:'vitamina_c_mg',1114:'vitamina_d_ug',1109:'vitamina_e_mg',1185:'vitamina_k_ug',
  1105:'retinol_ug',1107:'betacaroteno_ug',1108:'alfacaroteno_ug',1122:'licopeno_ug',1123:'luteina_zeaxantina_ug',1180:'colina_mg',1194:'betaina_mg',1253:'colesterol_mg',1063:'acucares_g',1235:'acucar_adicionado_g',1258:'gordura_saturada_g',1292:'gordura_monoinsaturada_g',1293:'gordura_poliinsaturada_g',1257:'gordura_trans_g',1051:'agua_g',1009:'amido_g',1057:'cafeina_mg',1058:'teobromina_mg'
};
const macroIDs={2047:'kcal',2048:'kcal',1008:'kcal',1003:'proteinas_g',1005:'carboidratos_g',1004:'gorduras_g',1079:'fibras_g'};
const english={arroz:'rice',branco:'white',integral:'brown',cozido:'cooked',cozida:'cooked',cru:'raw',crua:'raw',feijao:'beans',preto:'black',frango:'chicken',peito:'breast',ovo:'egg',carne:'beef',leite:'milk',batata:'potato',doce:'sweet',banana:'banana',aveia:'oats',macarrao:'pasta',pao:'bread',manteiga:'butter',azeite:'olive oil',grelhado:'grilled',grelhada:'grilled',assado:'roasted',assada:'roasted',frito:'fried',frita:'fried',sem:'without',sal:'salt',oleo:'oil'};
function reformulateLocal(s){return s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().split(/(\s+|,)/).map(w=>english[w]||w).join('').trim();}
async function reformulateAI(q){
 if(!process.env.OPENAI_API_KEY)return reformulateLocal(q);
 try{
  const r=await fetch('https://api.openai.com/v1/chat/completions',{method:'POST',headers:{'Authorization':'Bearer '+process.env.OPENAI_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({model:process.env.AVN_NUTRICAO_AI_MODEL||'gpt-4o-mini',temperature:0,max_tokens:100,messages:[{role:'system',content:'Translate the Brazilian Portuguese food name and preparation into concise English USDA FoodData Central food search keywords only. Do not generate nutrient facts. Output plain search keywords, nothing else.'},{role:'user',content:q}]}) ,signal:AbortSignal.timeout(13000)});
  if(!r.ok)return reformulateLocal(q);
  const d=await r.json();return String(d.choices?.[0]?.message?.content||reformulateLocal(q)).replace(/["\n]/g,' ').slice(0,150);
 }catch{return reformulateLocal(q);}
}
async function request(url){const key=process.env.USDA_API_KEY||'DEMO_KEY';const u=new URL(API+url);u.searchParams.set('api_key',key);
 const r=await fetch(u,{signal:AbortSignal.timeout(14000),headers:{Accept:'application/json'}});
 if(!r.ok){const e=new Error(r.status===429?'Limite temporário de consultas USDA atingido. Cadastre uma chave USDA_API_KEY no Render.':`USDA não respondeu à consulta (HTTP ${r.status}).`);e.status=r.status===429?429:502;throw e;}
 return r.json();}
async function search(q){
 const term=await reformulateAI(q);
 const data=await request('/foods/search?query='+encodeURIComponent(term)+'&pageSize=15');
 const foods=(data.foods||[]).filter(f=>Number.isInteger(f.fdcId));
 const originals=foods.map(f=>String(f.description||''));
 const translated=await traduzirTitulos(originals);
 return {pesquisa:term,opcoes:foods.map((f,i)=>({fdcId:f.fdcId,descricao:translated[i],descricaoOriginal:originals[i],tipo:String(f.dataType||''),marca:String(f.brandOwner||f.brandName||'')}))};
}
function safeNum(x){const n=Number(x);return x==null||!Number.isFinite(n)||n<0?null:n;}
function fromFood(food,cat){
 const macros={kcal:null,proteinas_g:null,carboidratos_g:null,gorduras_g:null,fibras_g:null},micros={};
 const allowed=new Map(cat.map(x=>[x.codigo,x.unidade]));
 for(const item of food.foodNutrients||[]){
  const n=item.nutrient||item;const id=Number(n.id||item.nutrientId);const val=safeNum(item.amount??item.value);if(val===null)continue;
  let unit=String(n.unitName||item.unitName||'').replace(/[μµ]/g,'u').toLowerCase();
  if(id===1008&&unit==='kj')continue; // energia em kJ não é kcal
  const macro=macroIDs[id];if(macro){if(macro==='kcal'&&unit!=='kcal')continue;if(macro!=='kcal'&&unit!=='g')continue;macros[macro]=val;continue;}
  const code=mapping[id];if(!code||!allowed.has(code))continue;
  const expected=allowed.get(code).replace(/[μµ]/g,'u').toLowerCase();if(unit!==expected)continue;
  micros[code]=val;
 }
 return {macros,micros};
}
async function detail(id,cat){
 const d=await request('/food/'+id);
 const {macros,micros}=fromFood(d,cat);
 const descricaoOriginal=String(d.description||'');
 const [descricao]=await traduzirTitulos([descricaoOriginal]);
 return {fdcId:Number(id),descricao,descricaoOriginal,tipo:String(d.dataType||''),marca:String(d.brandOwner||d.brandName||''),fonte:'USDA FoodData Central',fonteUrl:'https://fdc.nal.usda.gov/food-details/'+id+'/nutrients',macros,micros};
}
module.exports={search,detail,fromFood,reformulateLocal};
