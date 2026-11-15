/* AVN Dieta: fontes alimentares e correção contextual de micronutrientes. */
(()=>{
'use strict';
if(document.body.dataset.nutricaoPagina!=='dieta')return;
const core=window.AVNNutricaoInterno;
if(!core)return;
const {state,api,send,loadDiet}=core;
const $=id=>document.getElementById(id);
const SOURCE_FOODS={"sodio_mg":["Sal de cozinha","Queijos salgados","Azeitona","Embutidos","Alimentos industrializados salgados"],"potassio_mg":["Feijão cozido","Batata com casca","Banana","Abacate","Espinafre"],"calcio_mg":["Leite","Iogurte natural","Queijo","Sardinha com espinhas","Couve"],"ferro_mg":["Carne bovina","Fígado bovino","Feijão","Lentilha","Grão-de-bico"],"magnesio_mg":["Semente de abóbora","Castanha-de-caju","Aveia","Feijão","Espinafre"],"zinco_mg":["Ostras","Carne bovina","Semente de abóbora","Grão-de-bico","Queijo"],"selenio_ug":["Castanha-do-pará","Sardinha","Atum","Ovo","Frango"],"fosforo_mg":["Leite","Queijo","Frango","Peixe","Feijão"],"cobre_mg":["Fígado bovino","Castanha-de-caju","Semente de girassol","Cacau","Grão-de-bico"],"manganes_mg":["Aveia","Arroz integral","Nozes","Chá","Feijão"],"iodo_ug":["Sal iodado","Peixe marinho","Ovo","Leite","Algas marinhas"],"cloreto_mg":["Sal de cozinha","Alimentos preparados com sal","Queijos salgados","Azeitona"],"cromo_ug":["Brócolis","Carne bovina","Cereais integrais","Levedura de cerveja"],"molibdenio_ug":["Feijão","Lentilha","Ervilha","Aveia","Nozes"],"fluoreto_mg":["Água fluoretada","Chá-preto","Chá-verde","Peixes com espinhas"],"boro_mg":["Uva-passa","Ameixa seca","Abacate","Amêndoas","Feijão"],"enxofre_mg":["Ovo","Carne","Alho","Cebola","Brócolis"],"vitamina_a_ug":["Fígado bovino","Cenoura","Batata-doce alaranjada","Abóbora","Couve"],"vitamina_b1_mg":["Carne suína","Feijão","Semente de girassol","Cereais integrais","Aveia"],"vitamina_b2_mg":["Leite","Iogurte","Ovo","Fígado bovino","Amêndoas"],"vitamina_b3_mg":["Frango","Atum","Amendoim","Carne bovina","Cogumelos"],"vitamina_b5_mg":["Frango","Cogumelos","Abacate","Ovo","Fígado bovino"],"vitamina_b6_mg":["Frango","Atum","Grão-de-bico","Banana","Batata"],"vitamina_b7_ug":["Ovo cozido","Fígado bovino","Amendoim","Semente de girassol","Salmão"],"folato_ug":["Fígado bovino","Espinafre","Feijão-fradinho","Aspargos","Brócolis","Lentilha"],"vitamina_b12_ug":["Fígado bovino","Sardinha","Carne bovina","Ovo","Leite"],"vitamina_c_mg":["Acerola","Goiaba","Pimentão","Laranja","Brócolis"],"vitamina_d_ug":["Salmão","Sardinha","Gema de ovo","Cogumelos expostos à luz UV","Leite fortificado"],"vitamina_e_mg":["Semente de girassol","Amêndoas","Azeite de oliva","Abacate","Óleo de girassol"],"vitamina_k_ug":["Couve","Espinafre","Brócolis","Repolho","Alface"],"vitamina_k1_ug":["Couve","Espinafre","Salsinha","Brócolis","Alface"],"vitamina_k2_ug":["Natto (soja fermentada)","Queijos maturados","Gema de ovo","Alguns fermentados"],"retinol_ug":["Fígado bovino","Gema de ovo","Leite integral","Queijo","Manteiga"],"betacaroteno_ug":["Cenoura","Abóbora","Batata-doce alaranjada","Couve","Manga"],"alfacaroteno_ug":["Cenoura","Abóbora","Abóbora japonesa"],"licopeno_ug":["Tomate cozido","Molho de tomate","Goiaba vermelha","Melancia","Mamão"],"luteina_zeaxantina_ug":["Couve","Espinafre","Milho","Gema de ovo","Ervilha"],"colina_mg":["Ovo","Fígado bovino","Frango","Peixe","Soja"],"betaina_mg":["Beterraba","Espinafre","Farelo de trigo","Quinoa"],"colesterol_mg":["Gema de ovo","Fígado","Queijo","Camarão","Carne"],"acucares_g":["Frutas","Leite","Mel","Sucos","Doces"],"acucar_adicionado_g":["Refrigerante comum","Biscoitos recheados","Doces industrializados","Bebidas adoçadas"],"gordura_saturada_g":["Manteiga","Queijos gordos","Carnes gordas","Óleo de coco","Creme de leite"],"gordura_monoinsaturada_g":["Azeite de oliva","Abacate","Amendoim","Castanha-de-caju","Amêndoas"],"gordura_poliinsaturada_g":["Nozes","Semente de girassol","Óleo de soja","Salmão","Sementes"],"gordura_trans_g":["Produtos com gordura parcialmente hidrogenada","Alguns produtos de panificação industrializados","Pequenas quantidades em leite e carne de ruminantes"],"omega3_g":["Sardinha","Salmão","Semente de chia","Linhaça","Nozes"],"omega6_g":["Óleo de soja","Óleo de girassol","Nozes","Semente de girassol","Amendoim"],"epa_mg":["Sardinha","Salmão","Cavalinha","Arenque","Anchova"],"dha_mg":["Sardinha","Salmão","Cavalinha","Arenque","Truta"],"ala_mg":["Linhaça","Semente de chia","Nozes","Óleo de canola","Óleo de soja"],"amido_g":["Arroz","Batata","Mandioca","Aveia","Milho"],"poliois_g":["Produtos adoçados com sorbitol","Produtos adoçados com xilitol","Produtos adoçados com maltitol","Ameixa"],"cafeina_mg":["Café","Chá-preto","Chá-verde","Erva-mate","Chocolate amargo"],"teobromina_mg":["Cacau em pó","Chocolate amargo","Chocolate ao leite","Nibs de cacau"],"agua_g":["Melancia","Pepino","Tomate","Alface","Laranja"]};
const WATCH= new Set(["sodio_mg","cloreto_mg","colesterol_mg","acucar_adicionado_g","gordura_saturada_g","gordura_trans_g","cafeina_mg","teobromina_mg"]);
const GROUPS=['Vitaminas','Minerais','Outros'];
const MACROS=['kcal','proteinas_g','carboidratos_g','gorduras_g','fibras_g'];
const escapeText=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const numberText=(n,d=2)=>Number(n).toLocaleString('pt-BR',{maximumFractionDigits:d});
const foodMicros=food=>{
 const m=food?.micronutrientes_100g;
 if(typeof m==='string'){try{return JSON.parse(m)||{};}catch(_){return {};}}
 return m&&typeof m==='object'?m:{};
};
const hasAmount=(v)=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v))&&Number(v)>=0;
let catalogue=[],activeKey='',view='',editingId='',locked=false,sessionId='';
let sourcesTab='externos';
const externalExamples=new Map();
async function loadExternalExamples(key){
 if(externalExamples.has(key))return;
 externalExamples.set(key,{loading:true});
 try{
  const response=await api('/nutrientes/fontes-exemplos/'+encodeURIComponent(key));
  externalExamples.set(key,{data:response});
 }catch(err){externalExamples.set(key,{error:err.message||'Consulta indisponível'});}
 if(activeKey===key&&view==='sources'&&$('avnMicroFontesModal')?.open)renderDetails();
}
function externalList(n){
 const record=externalExamples.get(activeKey);
 if(!record||record.loading)return '<p class="muted" role="status">Consultando valores por 100 g na base USDA…</p>';
 if(record.error)return '<p class="muted" role="alert">Consulta indisponível: '+escapeText(record.error)+'. Nenhum valor foi estimado.</p>';
 const foods=Array.isArray(record.data?.alimentos)?record.data.alimentos.slice().sort((a,b)=>Number(b.valor_100g)-Number(a.valor_100g)):[];
 const message=record.data?.aviso?'<p class="muted">'+escapeText(record.data.aviso)+'</p>':'';
 if(!foods.length)return message+'<p class="muted">Nenhum exemplo com composição verificada disponível neste momento.</p>';
 return message+'<div class="avn-micro-food-list">'+foods.map(f=>{
  const url=/^https:\/\/fdc\.nal\.usda\.gov\/food-details\/\d+\/nutrients$/.test(f.fonte_url||'')?f.fonte_url:null;
  return '<div class="avn-micro-food-line"><div><strong>'+escapeText(f.nome||f.descricao_original||'Alimento')+'</strong>'+
   '<small>'+numberText(f.valor_100g,3)+' '+escapeText(f.unidade||n.unidade)+' por 100 g · '+escapeText(f.descricao_original||'USDA FoodData Central')+'</small></div>'+
   (url?'<a href="'+escapeText(url)+'" target="_blank" rel="noopener noreferrer">Ver fonte</a>':'')+'</div>';
 }).join('')+'</div><p class="muted">Dados informativos do USDA FoodData Central. Variedades e preparos diferentes podem ter outros valores; os exemplos não foram incluídos no seu catálogo AVN.</p>';
}
function ensureDialogs(){
 if(!$('avnMicroFontesModal')){
  document.body.insertAdjacentHTML('beforeend',
   '<dialog class="avn-dialog avn-micro-detail-dialog" id="avnMicroFontesModal" aria-labelledby="avnMicroFontesTitulo">'+
   '<div class="modal-head"><h3 id="avnMicroFontesTitulo">Alimentos</h3><button type="button" class="secondary" id="avnMicroFontesFechar">Voltar à análise</button></div>'+
   '<div id="avnMicroFontesConteudo"></div></dialog>'+
   '<dialog class="avn-dialog avn-micro-edit-dialog" id="avnMicroEditarModal" aria-labelledby="avnMicroEditarTitulo">'+
   '<div class="modal-head"><h3 id="avnMicroEditarTitulo">Micronutrientes do alimento</h3><button type="button" class="secondary" id="avnMicroEditarFechar">Cancelar</button></div>'+
   '<p class="muted">Composição por 100 g. Campo vazio = informação desconhecida; zero = valor realmente conhecido como zero.</p>'+
   '<label class="avn-field">Localizar nutriente<input type="search" id="avnMicroEditarBusca" placeholder="Pesquisar vitamina ou mineral"></label>'+
   '<form id="avnMicroEditarForm"><div class="avn-micro-edit-table-wrap"><table class="avn-micro-edit-table"><thead><tr><th>Nutriente</th><th>Valor por 100 g</th></tr></thead><tbody id="avnMicroEditarLinhas"></tbody></table></div>'+
   '<p class="avn-micro-edit-error" id="avnMicroEditarErro" role="alert" hidden></p>'+
   '<div class="modal-actions"><button type="submit" class="primary" id="avnMicroEditarSalvar">Salvar composição do alimento</button><button type="button" class="secondary" id="avnMicroEditarCancelar">Cancelar</button></div></form></dialog>');
 }
 $('avnMicroFontesFechar').onclick=()=>$('avnMicroFontesModal').close();
 $('avnMicroEditarFechar').onclick=()=>$('avnMicroEditarModal').close();
 $('avnMicroEditarCancelar').onclick=()=>$('avnMicroEditarModal').close();
 $('avnMicroEditarForm').onsubmit=saveFood;
 $('avnMicroEditarBusca').oninput=()=>{
  const term=fold($('avnMicroEditarBusca').value);
  $('avnMicroEditarLinhas').querySelectorAll('tr[data-search]').forEach(row=>{row.hidden=!!term&&!row.dataset.search.includes(term);});
  GROUPS.forEach(cat=>{
   const header=$('avnMicroEditarLinhas').querySelector('tr[data-category="'+cat+'"]');
   if(header)header.hidden=!!term&&![...$('avnMicroEditarLinhas').querySelectorAll('tr[data-group="'+cat+'"]')].some(row=>!row.hidden);
  });
 };
 $('avnMicroFontesConteudo').addEventListener('click',event=>{
  const tab=event.target.closest('button[data-fontes-tab]');
  if(tab){
   sourcesTab=tab.dataset.fontesTab==='avn'?'avn':'externos';
   renderDetails();
   if(sourcesTab==='externos')loadExternalExamples(activeKey);
   return;
  }
  const btn=event.target.closest('button[data-edit-food]');
  if(btn)openEditor(btn.dataset.editFood);
 });
}
const fold=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
function nutrient(key){return catalogue.find(n=>n.codigo===key);}
function editable(food){
 return food&&String(food.usuario_id)===String(state.usuarioId)&&['alimento','suplemento'].includes(food.tipo||'alimento')&&food.fonte!=='receita';
}
function showDetails(key,mode){
 if(!$('modalAnaliseDieta')?.open)return;
 if(!nutrient(key))return;
 activeKey=key;view=mode;sourcesTab='externos';sessionId=String(state.usuarioId||'');
 renderDetails();
 if(!$('avnMicroFontesModal').open)$('avnMicroFontesModal').showModal();
 if(mode==='sources')loadExternalExamples(key);
}
function renderDetails(){
 const target=$('avnMicroFontesConteudo'),n=nutrient(activeKey);
 if(!target||!n)return;
 const prefix=view==='missing'?'Sem informação: ':'Fontes alimentares de ';
 $('avnMicroFontesTitulo').textContent=prefix+n.nome;
 if(view==='missing'){
  const missing=state.dieta.filter(item=>{
   let comp=item.composicao_100g;
   if(typeof comp==='string'){try{comp=JSON.parse(comp);}catch(_){comp=null;}}
   const micros=comp?.micros||comp?.micronutrientes_100g||item.micronutrientes_100g||{};
   const data=typeof micros==='string'?(()=>{try{return JSON.parse(micros);}catch(_){return {};}})():micros;
   return !hasAmount(data?.[activeKey]);
  });
  target.innerHTML='<p class="muted">Itens da dieta programada sem um valor cadastrado para <strong>'+escapeText(n.nome)+'</strong>. Se o mesmo alimento aparece em duas refeições, as duas ocorrências são contadas.</p>'+
   (missing.length?'<div class="avn-micro-food-list">'+missing.map(item=>{
    const food=state.alimentos.find(f=>String(f.id)===String(item.alimento_id));
    const canEdit=editable(food);
    const label=escapeText(item.alimento_nome||food?.nome||'Alimento');
    return '<div class="avn-micro-food-line"><div><strong>'+label+'</strong><small>'+escapeText(item.refeicao||'Refeição')+' · '+numberText(item.quantidade_g,1)+' g planejados</small></div>'+
     (canEdit?'<button type="button" class="secondary" data-edit-food="'+escapeText(food.id)+'">Preencher micronutrientes</button>':
       '<small>'+(food?.tipo==='receita'?'Receita: edite os ingredientes no módulo Receitas.':'Cadastro não editável aqui; confira o módulo Alimentos.')+'</small>')+
     '</div>';
   }).join('')+'</div>':'<p class="avn-micro-complete">Todos os itens da dieta têm informação cadastrada para este nutriente.</p>')+
   '<p class="muted">Os valores novos são salvos no cadastro do alimento. A análise da dieta é recalculada ao salvar.</p>';
  return;
 }
 const registered=(Array.isArray(state.alimentos)?state.alimentos:[]).map(food=>({food,value:foodMicros(food)[activeKey]}))
  .filter(r=>hasAmount(r.value)&&Number(r.value)>0)
  .sort((a,b)=>Number(b.value)-Number(a.value));
 const caution=WATCH.has(activeKey)?
   '<p class="avn-micro-caution">Atenção: conhecer fontes deste componente não significa que seja desejável aumentar seu consumo. Considere limites e recomendações individuais.</p>':'';
 const tabs='<div class="avn-micro-source-tabs" role="tablist" aria-label="Categorias de fontes alimentares">'+
  '<button type="button" role="tab" data-fontes-tab="externos" aria-selected="'+(sourcesTab==='externos')+'" class="'+(sourcesTab==='externos'?'active':'')+'">Outros exemplos de fontes alimentares</button>'+
  '<button type="button" role="tab" data-fontes-tab="avn" aria-selected="'+(sourcesTab==='avn')+'" class="'+(sourcesTab==='avn'?'active':'')+'">Alimentos cadastrados no AVN</button></div>';
 const ownHtml=registered.length?'<div class="avn-micro-food-list">'+registered.map(({food,value})=>
   '<div class="avn-micro-food-line"><div><strong>'+escapeText(food.nome)+'</strong><small>'+numberText(value,3)+' '+escapeText(n.unidade)+' por 100 g · '+escapeText(food.preparo||food.marca||'Cadastro AVN')+'</small></div>'+
   (editable(food)?'<button type="button" class="secondary" data-edit-food="'+escapeText(food.id)+'">Editar composição</button>':'')+'</div>'
   ).join('')+'</div>':'<p class="muted">Nenhum alimento com valor positivo informado para este nutriente no catálogo carregado.</p>';
 target.innerHTML='<p class="muted">Compare as fontes por 100 g, do maior para o menor teor registrado.</p>'+caution+tabs+
  '<section role="tabpanel" aria-label="'+(sourcesTab==='externos'?'Outros exemplos de fontes alimentares':'Alimentos cadastrados no AVN')+'">'+
  (sourcesTab==='externos'?externalList(n):ownHtml)+'</section>';
}
function openEditor(id){
 if(locked)return;
 const food=state.alimentos.find(f=>String(f.id)===String(id));
 if(!editable(food))return;
 editingId=String(food.id);
 $('avnMicroEditarTitulo').textContent='Micronutrientes · '+food.nome;
 $('avnMicroEditarErro').hidden=true;
 $('avnMicroEditarBusca').value='';
 const existing=foodMicros(food);
 $('avnMicroEditarLinhas').innerHTML=GROUPS.map(cat=>{
  const rows=catalogue.filter(n=>(n.categoria||'Outros')===cat);
  return '<tr class="avn-micro-category-tr" data-category="'+cat+'"><th colspan="2">'+escapeText(cat==='Outros'?'Outros componentes':cat)+'</th></tr>'+
   rows.map(n=>'<tr data-group="'+cat+'" data-search="'+escapeText(fold(n.nome+' '+n.codigo))+'" class="'+(n.codigo===activeKey?'avn-micro-edit-highlight':'')+'">'+
    '<td><label for="avn-micro-input-'+escapeText(n.codigo)+'">'+escapeText(n.nome)+'</label></td>'+
    '<td><div class="avn-micro-edit-value"><input id="avn-micro-input-'+escapeText(n.codigo)+'" type="number" step="any" min="0" max="1000000" inputmode="decimal" data-code="'+escapeText(n.codigo)+'" value="'+
     (hasAmount(existing[n.codigo])?escapeText(existing[n.codigo]):'')+'" placeholder="Sem dado"><small>'+escapeText(n.unidade)+'</small></div></td></tr>').join('');
 }).join('');
 $('avnMicroEditarModal').showModal();
 const focus=$('avn-micro-input-'+activeKey);
 if(focus)focus.focus({preventScroll:true});
}
async function saveFood(event){
 event.preventDefault();
 if(locked)return;
 const food=state.alimentos.find(f=>String(f.id)===editingId),uid=String(state.usuarioId||'');
 if(!editable(food)||uid!==sessionId){$('avnMicroEditarErro').hidden=false;$('avnMicroEditarErro').textContent='Cadastro ou usuário alterado. Reabra a análise.';return;}
 const original=foodMicros(food),micros={...original};
 for(const input of $('avnMicroEditarLinhas').querySelectorAll('input[data-code]')){
  const raw=input.value.trim();
  if(!raw){delete micros[input.dataset.code];continue;}
  const value=Number(raw);
  if(!Number.isFinite(value)||value<0||value>1000000){
   input.focus();$('avnMicroEditarErro').hidden=false;$('avnMicroEditarErro').textContent='Confira o valor de '+input.dataset.code+'.';return;
  }
  micros[input.dataset.code]=value;
 }
 const payload={usuarioId:uid,tipo:food.tipo||'alimento',nome:food.nome,marca:food.marca||'',preparo:food.preparo||'',
  porcao_nome:food.porcao_nome||'',porcao_gramas:food.porcao_gramas??null,micronutrientes_100g:micros};
 for(const key of MACROS)payload[key+'_100g']=food[key+'_100g']??null;
 locked=true;$('avnMicroEditarSalvar').disabled=true;
 try{
  const saved=await send('/alimentos/'+encodeURIComponent(food.id),'PUT',payload);
  if(uid!==String(state.usuarioId))throw Error('Usuário alterado durante o salvamento. Recarregue a análise.');
  state.alimentos=state.alimentos.map(f=>String(f.id)===editingId?saved:f);
  await loadDiet();
  $('avnMicroEditarModal').close();
  await window.AVNDietaMicros?.refresh?.();
  renderDetails();
 }catch(err){
  $('avnMicroEditarErro').hidden=false;
  $('avnMicroEditarErro').textContent='Não foi possível salvar: '+(err.message||'erro desconhecido');
 }finally{locked=false;$('avnMicroEditarSalvar').disabled=false;}
}
async function init(){
 ensureDialogs();
 try{
  const response=await api('/nutrientes');
  catalogue=Array.isArray(response.micros)?response.micros:[];
 }catch(err){catalogue=[];console.error('[AVN micronutrientes] Não foi possível carregar o catálogo.',err);}
 $('conteudoMicrosDieta')?.addEventListener('click',event=>{
  const source=event.target.closest('[data-micro-fontes]');
  const missing=event.target.closest('[data-micro-faltantes]');
  if(source)showDetails(source.dataset.microFontes,'sources');
  else if(missing)showDetails(missing.dataset.microFaltantes,'missing');
 });
 $('modalAnaliseDieta')?.addEventListener('close',()=>{
  if($('avnMicroEditarModal')?.open)$('avnMicroEditarModal').close();
  if($('avnMicroFontesModal')?.open)$('avnMicroFontesModal').close();
 });
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();