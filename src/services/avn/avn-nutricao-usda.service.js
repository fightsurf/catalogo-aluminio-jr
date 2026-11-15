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

// Exemplos externos de fontes alimentares, SEM misturar com os alimentos do usuário.
// O teor por 100 g vem exclusivamente do FoodData Central; nunca é inferido do nome.
const FONTES_EXEMPLOS={
 sodio_mg:[['Azeitona','olives green'],['Queijo parmesão','parmesan cheese'],['Atum em conserva','tuna canned'],['Pão integral','bread whole wheat'],['Presunto','ham'],['Sal de cozinha','salt table']],
 potassio_mg:[['Feijão branco','beans white'],['Batata assada','potatoes baked'],['Espinafre cozido','spinach cooked'],['Abacate cru','avocados raw'],['Banana crua','bananas raw'],['Lentilha cozida','lentils cooked'],['Salmão','salmon']],
 calcio_mg:[['Queijo parmesão','cheese parmesan'],['Sementes de gergelim','sesame seeds'],['Leite em pó','milk dry'],['Sardinha com espinhas','sardines canned'],['Iogurte natural','yogurt plain'],['Couve','kale'],['Leite integral','milk whole']],
 ferro_mg:[['Fígado bovino','liver beef'],['Ostra','oysters'],['Lentilha','lentils'],['Feijão branco','beans white'],['Espinafre','spinach'],['Semente de abóbora','pumpkin seeds'],['Carne bovina','beef']],
 magnesio_mg:[['Semente de abóbora','pumpkin seeds'],['Semente de chia','chia seeds'],['Castanha-de-caju','cashews'],['Amêndoas','almonds'],['Aveia','oats'],['Feijão-preto','beans black'],['Espinafre','spinach']],
 zinco_mg:[['Ostra','oysters'],['Carne bovina','beef'],['Semente de abóbora','pumpkin seeds'],['Queijo cheddar','cheese cheddar'],['Grão-de-bico','chickpeas'],['Aveia','oats'],['Iogurte','yogurt']],
 selenio_ug:[['Castanha-do-pará','brazil nuts'],['Atum','tuna'],['Sardinha','sardines'],['Ovo','egg whole'],['Frango','chicken breast'],['Arroz integral','rice brown'],['Cogumelo','mushrooms']],
 fosforo_mg:[['Semente de abóbora','pumpkin seeds'],['Queijo parmesão','parmesan cheese'],['Salmão','salmon'],['Sardinha','sardines'],['Frango','chicken breast'],['Lentilha','lentils'],['Leite','milk whole']],
 cobre_mg:[['Fígado bovino','liver beef'],['Ostra','oysters'],['Castanha-de-caju','cashews'],['Semente de girassol','sunflower seeds'],['Cacau em pó','cocoa powder'],['Grão-de-bico','chickpeas'],['Amêndoas','almonds']],
 manganes_mg:[['Aveia','oats'],['Nozes','walnuts'],['Arroz integral','rice brown'],['Semente de abóbora','pumpkin seeds'],['Avelã','hazelnuts'],['Feijão','beans'],['Espinafre','spinach']],
 vitamina_a_ug:[['Fígado bovino','liver beef'],['Batata-doce','sweet potato'],['Cenoura crua','carrots raw'],['Espinafre','spinach'],['Abóbora','pumpkin'],['Couve','kale'],['Manga','mangos']],
 vitamina_b1_mg:[['Carne suína','pork'],['Semente de girassol','sunflower seeds'],['Feijão branco','beans white'],['Aveia','oats'],['Ervilha','peas'],['Arroz integral','rice brown'],['Lentilha','lentils']],
 vitamina_b2_mg:[['Fígado bovino','liver beef'],['Amêndoas','almonds'],['Cogumelo','mushrooms'],['Ovo','egg whole'],['Iogurte natural','yogurt plain'],['Leite','milk whole'],['Espinafre','spinach']],
 vitamina_b3_mg:[['Atum','tuna'],['Frango','chicken breast'],['Amendoim','peanuts'],['Salmão','salmon'],['Carne bovina','beef'],['Cogumelos','mushrooms'],['Arroz integral','rice brown']],
 vitamina_b5_mg:[['Fígado bovino','liver beef'],['Cogumelo','mushrooms'],['Semente de girassol','sunflower seeds'],['Abacate','avocados raw'],['Frango','chicken breast'],['Ovo','egg whole'],['Iogurte','yogurt plain']],
 vitamina_b6_mg:[['Pistache','pistachios'],['Atum','tuna'],['Salmão','salmon'],['Frango','chicken breast'],['Grão-de-bico','chickpeas'],['Banana','bananas raw'],['Batata','potatoes']],
 folato_ug:[['Fígado bovino','liver beef'],['Lentilha cozida','lentils cooked'],['Espinafre cru','spinach raw'],['Feijão-fradinho','cowpeas'],['Aspargo','asparagus'],['Abacate cru','avocados raw'],['Brócolis','broccoli'],['Grão-de-bico','chickpeas']],
 vitamina_b12_ug:[['Fígado bovino','liver beef'],['Mariscos','clams'],['Ostras','oysters'],['Sardinha','sardines'],['Salmão','salmon'],['Ovo','egg whole'],['Leite','milk whole']],
 vitamina_c_mg:[['Acerola','acerola'],['Goiaba','guavas'],['Pimentão amarelo','peppers yellow sweet'],['Kiwi','kiwifruit'],['Laranja','oranges'],['Brócolis','broccoli'],['Morango','strawberries']],
 vitamina_d_ug:[['Óleo de fígado de bacalhau','cod liver oil'],['Salmão','salmon'],['Truta','trout'],['Sardinha','sardines'],['Atum','tuna'],['Gema de ovo','egg yolk'],['Leite fortificado','milk vitamin D added']],
 vitamina_e_mg:[['Óleo de gérmen de trigo','wheat germ oil'],['Semente de girassol','sunflower seeds'],['Amêndoas','almonds'],['Avelã','hazelnuts'],['Abacate','avocados raw'],['Espinafre','spinach'],['Amendoim','peanuts']],
 vitamina_k_ug:[['Couve','kale'],['Espinafre','spinach'],['Repolho','cabbage'],['Brócolis','broccoli'],['Alface','lettuce'],['Aspargo','asparagus'],['Ervilha','peas']],
 retinol_ug:[['Fígado bovino','liver beef'],['Óleo de fígado de bacalhau','cod liver oil'],['Manteiga','butter'],['Queijo','cheese'],['Gema de ovo','egg yolk'],['Leite integral','milk whole']],
 betacaroteno_ug:[['Cenoura','carrots raw'],['Batata-doce','sweet potato'],['Couve','kale'],['Espinafre','spinach'],['Abóbora','pumpkin'],['Manga','mangos'],['Melão cantalupo','cantaloupe']],
 alfacaroteno_ug:[['Cenoura','carrots raw'],['Abóbora','pumpkin'],['Batata-doce','sweet potato'],['Melão cantalupo','cantaloupe'],['Vagem','beans snap'],['Banana','bananas raw']],
 licopeno_ug:[['Tomate concentrado','tomato paste'],['Tomate cozido','tomatoes cooked'],['Goiaba vermelha','guavas'],['Melancia','watermelon'],['Tomate cru','tomatoes raw'],['Mamão','papayas']],
 luteina_zeaxantina_ug:[['Couve','kale'],['Espinafre','spinach'],['Salsa','parsley'],['Ervilha','peas'],['Brócolis','broccoli'],['Milho','corn'],['Gema de ovo','egg yolk']],
 colina_mg:[['Fígado bovino','liver beef'],['Gema de ovo','egg yolk'],['Ovo','egg whole'],['Salmão','salmon'],['Frango','chicken breast'],['Soja','soybeans'],['Brócolis','broccoli']],
 betaina_mg:[['Farelo de trigo','wheat bran'],['Beterraba','beets'],['Espinafre','spinach'],['Quinoa','quinoa'],['Batata-doce','sweet potato'],['Arroz integral','rice brown']],
 colesterol_mg:[['Gema de ovo','egg yolk'],['Fígado bovino','liver beef'],['Ovo','egg whole'],['Camarão','shrimp'],['Queijo','cheese'],['Frango','chicken breast']],
 acucares_g:[['Mel','honey'],['Uva passa','raisins'],['Tâmara','dates'],['Banana','bananas'],['Maçã','apples'],['Leite','milk whole']],
 gordura_saturada_g:[['Óleo de coco','coconut oil'],['Manteiga','butter'],['Queijo cheddar','cheese cheddar'],['Chocolate amargo','chocolate dark'],['Carne bovina','beef'],['Leite integral','milk whole']],
 gordura_monoinsaturada_g:[['Azeite de oliva','olive oil'],['Amêndoas','almonds'],['Abacate','avocados raw'],['Amendoim','peanuts'],['Castanha-de-caju','cashews'],['Avelã','hazelnuts']],
 gordura_poliinsaturada_g:[['Óleo de girassol','sunflower oil'],['Nozes','walnuts'],['Semente de girassol','sunflower seeds'],['Salmão','salmon'],['Linhaça','flaxseed'],['Amêndoas','almonds']],
 gordura_trans_g:[['Manteiga','butter'],['Carne bovina','beef'],['Leite integral','milk whole'],['Queijo','cheese']],
 amido_g:[['Arroz','rice'],['Batata','potatoes'],['Aveia','oats'],['Milho','corn'],['Banana verde','plantains'],['Pão integral','bread whole wheat']],
 cafeina_mg:[['Café em pó','coffee ground'],['Café preparado','coffee brewed'],['Chá-preto','tea black'],['Chá-verde','tea green'],['Chocolate amargo','chocolate dark'],['Cacau em pó','cocoa powder']],
 teobromina_mg:[['Cacau em pó','cocoa powder'],['Chocolate amargo','chocolate dark'],['Chocolate ao leite','chocolate milk'],['Chá-preto','tea black']],
 agua_g:[['Pepino','cucumber'],['Alface','lettuce'],['Melancia','watermelon'],['Tomate','tomatoes raw'],['Laranja','oranges'],['Abacate','avocados raw']]
};
const exemplosCache=new Map();
function valoresBuscados(food, codigo,unidade){
 if(!['Foundation','SR Legacy'].includes(String(food.dataType||'')))return null;
 const normalized=fromFood(food,[{codigo,unidade}]).micros[codigo];
 return Number.isFinite(normalized)&&normalized>=0?normalized:null;
}
async function exemplosPorNutriente(codigo,unidade){
 const termos=FONTES_EXEMPLOS[codigo];
 if(!termos?.length)return {alimentos:[],aviso:'Sem exemplos com valores verificados disponíveis para este componente na base utilizada.'};
 const cacheKey=codigo+':'+unidade;
 const cached=exemplosCache.get(cacheKey);
 if(cached&&Date.now()-cached.at<12*60*60*1000)return cached.data;
 // Cada pesquisa usa registros não comerciais Foundation/SR Legacy por 100 g.
 // Falhas isoladas não devem bloquear outras fontes; erros de quota são sinalizados.
 let quota=false;const found=[];let succeed=0;
 const segments=[];
 for(let i=0;i<termos.length;i+=3)segments.push(termos.slice(i,i+3));
 for(const segment of segments){
  const out=await Promise.allSettled(segment.map(async ([nome,query])=>{
   const data=await request('/foods/search?'+new URLSearchParams({
    query,pageSize:'25',dataType:'Foundation,SR Legacy'
   }).toString());
   return {nome,query,foods:Array.isArray(data.foods)?data.foods:[]};
  }));
  for(let k=0;k<out.length;k++){
   const one=out[k];
   if(one.status==='rejected'){if(one.reason?.status===429)quota=true;continue;}
   succeed++;
   const {nome,query,foods}=one.value;
   const words=query.toLowerCase().split(/\s+/).filter(w=>w.length>2);
   const candidates=foods.filter(f=>words.every(w=>String(f.description||'').toLowerCase().includes(w)))
    .map(f=>({f,value:valoresBuscados(f,codigo,unidade)}))
    .filter(x=>x.value!==null);
   const first=candidates[0]||foods.map(f=>({f,value:valoresBuscados(f,codigo,unidade)})).find(x=>x.value!==null);
   if(!first)continue;
   found.push({
    nome,descricao_original:first.f.description,
    valor_100g:first.value,unidade,
    fonte:'USDA FoodData Central',fonte_url:'https://fdc.nal.usda.gov/food-details/'+first.f.fdcId+'/nutrients',
    fdc_id:first.f.fdcId
   });
  }
  if(quota)break;
 }
 found.sort((a,b)=>b.valor_100g-a.valor_100g||a.nome.localeCompare(b.nome,'pt-BR'));
 const data={alimentos:found,aviso:quota?'Limite de consultas USDA atingido; lista parcial.':'',fonte:'USDA FoodData Central'};
 if(succeed&&found.length)exemplosCache.set(cacheKey,{data,at:Date.now()});
 return data;
}

module.exports={search,detail,fromFood,reformulateLocal,exemplosPorNutriente};
