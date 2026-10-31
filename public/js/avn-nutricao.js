/* AVN Nutrição v1 — diário distinto da dieta planejada; dados por 100g. */
(()=>{'use strict';
const $=id=>document.getElementById(id);
const API='/avn/sistema/api/nutricao';
const PAGE=document.body.dataset.nutricaoPagina||'diario';
const has=id=>!!document.getElementById(id);
const MEALS={cafe:'Café da manhã',lanche_manha:'Lanche da manhã',almoco:'Almoço',lanche_tarde:'Lanche da tarde',jantar:'Jantar',ceia:'Ceia',outros:'Outros'};
const DAYS=['Segunda','Terça','Quarta','Quinta','Sexta','Sábado','Domingo'];
const MACROS=[['kcal','Energia','kcal'],['proteinas_g','Proteínas','g'],['carboidratos_g','Carboidratos','g'],['gorduras_g','Gorduras','g'],['fibras_g','Fibras','g']];
let MICRO=[]; // definição dinâmica via tabela avn_nutrientes
let iaSelecionado=null;
const state={usuarioId:'',alimentos:[],diario:[],dieta:[],perfis:[],metas:{},data:'',tab:'diario',dias:0,loading:false,origemImportacao:null};
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=(n,d=1)=>Number(n).toLocaleString('pt-BR',{maximumFractionDigits:d});
const localDate=()=>{const d=new Date(),a=n=>String(n).padStart(2,'0');return `${d.getFullYear()}-${a(d.getMonth()+1)}-${a(d.getDate())}`;};
const diaSemana=data=>(new Date(data+'T12:00:00').getDay()+6)%7;
const v=id=>$(id).value;
function show(msg,error=false){const el=$('alerta');el.hidden=false;el.textContent=msg;el.className='avn-alert'+(error?' error':'');clearTimeout(show.timer);show.timer=setTimeout(()=>el.hidden=true,6500);}
async function api(url,options={}){
 const r=await fetch(API+url,{credentials:'same-origin',headers:{'Content-Type':'application/json'},...options});
 if(r.redirected&&r.url.includes('/login'))throw Error('Sessão expirada. Entre novamente no sistema.');
 const json=await r.json().catch(()=>{throw Error('Resposta inválida do servidor. Confira sua sessão.');});
 if(!r.ok)throw Error(json.erro||'Não foi possível concluir.');return json;
}
const send=(url,method,body)=>api(url,{method,body:body===undefined?undefined:JSON.stringify(body)});
function userGuard(){if(!state.usuarioId)throw Error('Cadastre e selecione um usuário no AVN.');}
function nInput(key,label,unit,value='',prefix='micro') {return `<label class="avn-field">${esc(label)} (${esc(unit)})<input type="number" min="0" max="1000000" step="any" id="${prefix}_${key}" value="${value==null?'':esc(value)}" placeholder="Sem dado"></label>`;}
function inputNutrientes(prefix,container,preserve=false){
 const previous={};
 if(!has(container))return;
 if(preserve)for(const input of $(container).querySelectorAll('input[data-nutriente]'))previous[input.dataset.nutriente]=input.value;
 const categories=['Vitaminas','Minerais','Outros'];
 $(container).innerHTML=categories.map(category=>{
  const fields=MICRO.filter(n=>n[3]===category);
  if(!fields.length)return '';
  const title={Vitaminas:'Vitaminas',Minerais:'Minerais',Outros:'Outros componentes'}[category];
  return `<h4 class="micro-category" data-categoria="${category}">${title}</h4>`+
    fields.map(([key,label,unit])=>`<label class="avn-field" data-categoria="${category}" data-search="${esc((label+' '+unit).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase())}">
    ${esc(label)} (${esc(unit)})<input data-nutriente="${esc(key)}" type="number" min="0" max="1000000" step="any" id="${prefix}_${esc(key)}" value="${esc(previous[key]??'')}" placeholder="Sem dado"></label>`).join('');
 }).join('');
}
function filtrarNutrientes(container,searchId){
 if(!has(container)||!has(searchId))return;
 const q=$(searchId).value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
 const fields=[...$(container).querySelectorAll('label[data-search]')];
 fields.forEach(el=>el.hidden=!!q&&!el.dataset.search.includes(q));
 for(const group of $(container).querySelectorAll('h4[data-categoria]')){
  group.hidden=!fields.some(f=>f.dataset.categoria===group.dataset.categoria&&!f.hidden);
 }
}
function inputs(){
 if(has('camposMacros'))$('camposMacros').innerHTML=MACROS.map(([k,l,u])=>nInput(k,l,u,'','alim')).join('');
 if(has('camposMetas'))$('camposMetas').innerHTML=MACROS.map(([k,l,u])=>nInput(k,l,u,'','meta')).join('');
 inputNutrientes('micro','camposMicros');inputNutrientes('metamicro','camposMicroMetas');
 for(const id of ['diarioRefeicao','dietaRefeicao'])if(has(id)){
  $(id).innerHTML=Object.entries(MEALS).map(([k,l])=>`<option value="${k}">${l}</option>`).join('');$(id).value='almoco';
 }
}
async function loadNutrients(preserve=false){
 const r=await api('/nutrientes');
 MICRO=r.micros.map(x=>[x.codigo,x.nome,x.unidade,x.categoria]);
 if(preserve){inputNutrientes('micro','camposMicros',true);inputNutrientes('metamicro','camposMicroMetas',true);
  filtrarNutrientes('camposMicros','buscaMicroAlimento');filtrarNutrientes('camposMicroMetas','buscaMicroMetas');}
}
function selectFoods(){const opt=state.alimentos.map(f=>`<option value="${f.id}">${esc(f.nome)}${f.preparo?' · '+esc(f.preparo):''}${f.marca?' · '+esc(f.marca):''}</option>`).join('');
 for(const id of ['diarioAlimento','dietaAlimento']){if(!has(id))continue;const e=$(id),prev=e.value;e.innerHTML='<option value="">Selecione um alimento</option>'+opt;if(state.alimentos.some(f=>String(f.id)===prev))e.value=prev;}
}
function composition(a){return {kcal:a.kcal_100g,proteinas_g:a.proteinas_g_100g,carboidratos_g:a.carboidratos_g_100g,gorduras_g:a.gorduras_g_100g,fibras_g:a.fibras_g_100g,micros:a.micronutrientes_100g||{}};}
function aggregate(items){
 const total={},miss={};for(const [key] of [...MACROS,...MICRO]){total[key]=0;miss[key]=0;}
 for(const item of items){const data=item.composicao_100g||composition(item),grams=Number(item.quantidade_g||0);
  for(const [key] of MACROS){const val=data[key];if(val==null||val==='')miss[key]++;else total[key]+=Number(val)*grams/100;}
  for(const [key] of MICRO){const val=(data.micros||{})[key];if(val==null||val==='')miss[key]++;else total[key]+=Number(val)*grams/100;}
 }
 return {total,miss,count:items.length};
}
function stat(total,missing,key,label,unit,goal){
 const unknown=missing[key]>0;const present=total.count>0&&missing[key]===total.count;
 const amount=present?'Sem dado':fmt(total[key],key==='kcal'?0:1)+' '+unit;
 const value=goal==null?null:Number(goal);const ratio=value&&value>0?total[key]/value:null;
 return `<div class="stat"><small>${label}</small><strong>${amount}${unknown&&!present?'*':''}</strong><small>${value==null?'Meta não definida':`Meta: ${fmt(value)} ${unit}`}${unknown?' · dados incompletos':''}</small>${ratio!==null?`<div class="progress"><span style="width:${Math.min(100,ratio*100).toFixed(1)}%"></span></div>`:''}</div>`;
}

function resumoMetaDupla(itens,descricao){
 const a=aggregate(itens);
 return MACROS.slice(0,4).map(([key,label,unit])=>{
  const goal=state.metas[key],valid=goal!==null&&goal!==undefined&&goal!==''&&Number.isFinite(Number(goal));
  const sem=a.count>0&&a.miss[key]===a.count;
  return '<div class="avn-dieta-macro-coluna"><div class="stat avn-dieta-meta">'+
   '<small class="avn-dieta-card-titulo">Minha meta · '+esc(label)+'</small><strong>'+
   (valid?fmt(Number(goal),key==='kcal'?0:1)+' '+unit:'Não definida')+'</strong></div>'+
   '<div class="stat avn-dieta-planejado"><small class="avn-dieta-card-titulo">'+esc(descricao)+' · '+esc(label)+'</small><strong>'+
   (sem?'Sem dado':fmt(a.total[key],key==='kcal'?0:1)+' '+unit)+'</strong>'+
   (a.miss[key]&&!sem?'<small class="avn-dieta-card-nota">Valores incompletos em alguns alimentos.</small>':'')+'</div></div>';
 }).join('');
}
function renderDaily(){
 if(!has('resumoDiario'))return;
 $('resumoDiario').innerHTML=resumoMetaDupla(state.diario,'Total consumido');
 const groups=Object.keys(MEALS).map(key=>[key,state.diario.filter(i=>i.refeicao===key)]).filter(([,items])=>items.length);
 $('listaDiario').innerHTML=groups.length?groups.map(([key,items])=>{
  const sub=aggregate(items);
  return '<section class="avn-dieta-refeicao"><div class="avn-dieta-refeicao-cabecalho">'+
   '<h4><a href="#" data-macro-meal="'+esc(key)+'" data-macro-source="diario">'+esc(MEALS[key])+' <span class="avn-dieta-emoji">'+emojiRefeicao(key)+'</span></a></h4><span>'+
   items.length+' alimento(s)</span></div><div class="avn-perfil-acoes">'+
   '<button type="button" data-diario-adicionar="'+esc(key)+'">+ Adicionar alimento</button>'+
   '<button type="button" data-diario-repetir="'+esc(key)+'">Repetir refeição</button></div>'+
   '<div class="avn-dieta-refeicao-itens">'+items.map(i=>
    '<div class="list-row avn-dieta-linha"><div><span class="name">'+esc(i.alimento_nome)+' <span class="avn-dieta-emoji">'+emojiAlimento(i.alimento_nome)+'</span></span>'+
    '<small>'+fmt(i.quantidade_g)+' g consumidos'+(i.plano_item_id?' · da dieta':'')+'</small>'+
    resumoMacrosProgramados(aggregate([i]),'Macronutrientes de '+i.alimento_nome)+'</div>'+
    '<div class="avn-dieta-acoes"><button type="button" class="secondary" data-edit-consumo="'+esc(i.id)+'">Editar</button>'+
    '<button type="button" class="delete" data-consumo="'+esc(i.id)+'">Excluir</button></div></div>').join('')+
   '</div><div class="avn-dieta-totais-refeicao">'+resumoMacrosProgramados(sub,'Total de '+MEALS[key])+'</div></section>';
 }).join(''):'<p class="muted">Nenhum alimento registrado nesta data.</p>';
 $('listaDiario').querySelectorAll('[data-consumo]').forEach(btn=>btn.onclick=async()=>{
  if(!confirm('Excluir este alimento do diário?'))return;
  try{await send('/diario/'+state.usuarioId+'/'+btn.dataset.consumo,'DELETE');await loadDaily();show('Registro excluído.');}
  catch(e){show(e.message,true);}
 });
}

// Emojis calculados no navegador, em tempo de execução, sem IA ou cadastro manual.
// A normalização ignora acentos, maiúsculas, sinais e variações de escrita.
function emojiAlimento(nome){
 const texto=String(nome||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
 const regras=[
  [/\b(tangerina|mexerica|bergamota|laranja)\b/,'🍊'],
  [/\b(maca)\b/,'🍎'],[/\b(banana)\b/,'🍌'],[/\b(morango)\b/,'🍓'],
  [/\b(uva|passas)\b/,'🍇'],[/\b(melancia)\b/,'🍉'],[/\b(abacaxi)\b/,'🍍'],
  [/\b(manga)\b/,'🥭'],[/\b(pera)\b/,'🍐'],[/\b(pessego)\b/,'🍑'],
  [/\b(limao)\b/,'🍋'],[/\b(coco)\b/,'🥥'],[/\b(abacate)\b/,'🥑'],
  [/\b(castanha|noz|nozes|amendoim|amendoas|pistache)\b/,'🌰'],
  [/\b(arroz|risoto)\b/,'🍚'],[/\b(feijao|lentilha|grao de bico|ervilha)\b/,'🫘'],
  [/\b(ovo|ovos|omelete)\b/,'🥚'],[/\b(frango|galinha|peru)\b/,'🍗'],
  [/\b(salmao|atum|sardinha|tilapia|peixe)\b/,'🐟'],[/\b(cam[ar]ao|camar[aã]o)\b/,'🦐'],
  [/\b(carne|bife|patinho|acem|alcatra|picanha)\b/,'🥩'],
  [/\b(tapioca|pao|torrada|cuscuz)\b/,'🍞'],[/\b(aveia|granola|cereal)\b/,'🥣'],
  [/\b(macaxeira|mandioca|aipim|batata|inhame)\b/,'🥔'],[/\b(cenoura)\b/,'🥕'],
  [/\b(brocolis|couve flor|repolho)\b/,'🥦'],[/\b(tomate)\b/,'🍅'],
  [/\b(milho|pipoca)\b/,'🌽'],[/\b(alface|couve|espinafre|rucula|salada)\b/,'🥬'],
  [/\b(abobrinha|pepino)\b/,'🥒'],[/\b(queijo|requeijao|ricota)\b/,'🧀'],
  [/\b(leite|iogurte|whey)\b/,'🥛'],[/\b(cafe|cappuccino)\b/,'☕'],
  [/\b(chocolate|cacau|brigadeiro)\b/,'🍫'],[/\b(bolo|torta)\b/,'🍰'],
  [/\b(agua)\b/,'💧'],[/\b(suco|vitamina)\b/,'🧃'],[/\b(azeite|oleo|manteiga)\b/,'🧈']
 ];
 return (regras.find(([exp])=>exp.test(texto))||[null,'🍽️'])[1];
}
function emojiRefeicao(chave){
 return {cafe:'☀️',lanche_manha:'🍏',almoco:'🍽️',lanche_tarde:'🥪',jantar:'🌙',ceia:'🌜',outros:'🍴'}[chave]||'🍽️';
}
function resumoMacrosProgramados(dados,descricao){
 const macros=[['kcal','Energia','kcal',0],['proteinas_g','Proteínas','g',1],['carboidratos_g','Carboidratos','g',1],['gorduras_g','Gorduras','g',1],['fibras_g','Fibras','g',1]];
 return '<div class="avn-dieta-macros-inline" aria-label="'+esc(descricao)+'">'+macros.map(([key,nome,unidade,casas])=>{
  const semDado=dados.count>0&&dados.miss[key]===dados.count;
  const parcial=dados.miss[key]>0&&!semDado;
  const valor=semDado?'Sem dado':fmt(dados.total[key],casas)+' '+unidade+(parcial?'*':'');
  return '<span><b>'+nome+':</b> '+valor+'</span>';
 }).join('')+'</div>';
}
function renderDiet(){
 if(!has('listaDieta'))return;
 const rows=state.dieta;
 const a=aggregate(rows);
 const grouped=Object.keys(MEALS).map(key=>[key,rows.filter(item=>item.refeicao===key)]).filter(([key,items])=>items.length||state.perfis.some(p=>p.refeicao===key));
 $('listaDieta').innerHTML=grouped.length?grouped.map(([key,items])=>{
  const subtotal=aggregate(items);
  const ativo=state.perfis.find(p=>p.refeicao===key&&p.ativo);
  const lancados=items.filter(i=>state.diario.some(d=>d.plano_item_id!=null&&String(d.plano_item_id)===String(i.id))).length;
  return '<section class="avn-dieta-refeicao" aria-label="'+esc(MEALS[key])+'">'+
   '<div class="avn-dieta-refeicao-cabecalho avn-dieta-cabecalho-com-perfis">'+
   '<div class="avn-dieta-cabecalho-linha"><h4><a href="#" data-macro-meal="'+esc(key)+'" data-macro-source="dieta">'+esc(MEALS[key])+' <span class="avn-dieta-emoji" aria-hidden="true">'+emojiRefeicao(key)+'</span></a></h4>'+
   '<div class="avn-perfil-acoes"><small>Perfil atual: <b>'+esc(ativo?.nome||'Original')+'</b></small>'+
   '<button type="button" class="avn-perfil-botao" data-perfis-refeicao="'+esc(key)+'"><span aria-hidden="true">🔄</span> Selecionar '+esc(MEALS[key])+' <span aria-hidden="true">'+emojiRefeicao(key)+'</span></button>'+
   '<button type="button" class="avn-perfil-botao" data-enviar-refeicao="'+esc(key)+'"'+(items.length?'':' disabled title="Adicione alimentos antes de registrar o consumo"')+'><span aria-hidden="true">📒</span> Adicionar ao diário alimentar</button>'+
   '<button type="button" class="avn-perfil-botao" data-adicionar-refeicao="'+esc(key)+'"><span aria-hidden="true">➕</span> Adicionar alimento à refeição</button>'+
   '</div></div>'+
   '<div class="avn-dieta-cabecalho-meta"><span class="avn-dieta-contagem">'+items.length+' alimento(s)</span>'+
   (lancados?'<small class="avn-dia-registrado">'+lancados+'/'+items.length+' lançado(s) hoje</small>':'')+'</div></div>'+
   '<div class="avn-dieta-refeicao-itens">'+items.map(i=>{
    const nutrientes=aggregate([i]);
    return '<div class="list-row avn-dieta-linha" data-dieta-item="'+esc(i.id)+'"><div><a href="#" class="name avn-dieta-alimento-link" data-macro-food="'+esc(i.id)+'" aria-label="Ver macronutrientes de '+esc(i.alimento_nome)+'">'+esc(i.alimento_nome)+' <span class="avn-dieta-emoji" aria-hidden="true">'+emojiAlimento(i.alimento_nome)+'</span></a>'+
      '<small>'+fmt(i.quantidade_g)+' g programados</small>'+
      resumoMacrosProgramados(nutrientes,'Macronutrientes de '+i.alimento_nome)+'</div>'+
      '<div class="avn-dieta-acoes"><a href="#" data-editar-plano="'+esc(i.id)+'" aria-label="Editar '+esc(i.alimento_nome)+'">Editar</a>'+
      '<button type="button" class="delete" data-plano="'+esc(i.id)+'">Excluir</button></div></div>';
   }).join('')+(items.length?'':'<p class="avn-refeicao-vazia">Nenhum alimento neste perfil. Use “➕ Adicionar alimento à refeição” ao lado da refeição.</p>')+'</div>'+
   '<div class="avn-dieta-totais-refeicao">'+resumoMacrosProgramados(subtotal,'Total de macronutrientes de '+MEALS[key])+
   (Object.values(subtotal.miss).some(n=>n>0)?'<small class="muted">* Alguns valores nutricionais estão incompletos.</small>':'')+
   '</div></section>';
 }).join(''):'<p class="muted">Nenhuma refeição programada.</p>';
 $('resumoDieta').innerHTML=MACROS.slice(0,4).map(([key,label,unit])=>{
  const unknown=rows.length>0&&a.miss[key]===rows.length;
  const partial=rows.length>0&&a.miss[key]>0&&!unknown;
  const goal=state.metas[key];
  const goalDefined=goal!==null&&goal!==undefined&&goal!==''&&Number.isFinite(Number(goal));
  const goalText=goalDefined?fmt(Number(goal),key==='kcal'?0:1)+' '+esc(unit):'Não definida';
  const plannedText=unknown?'Sem dado':fmt(a.total[key],key==='kcal'?0:1)+' '+esc(unit);
  return '<div class="avn-dieta-macro-coluna">'+
   '<div class="stat avn-dieta-meta"><small class="avn-dieta-card-titulo">Minha meta · '+esc(label)+'</small><strong>'+goalText+'</strong></div>'+
   '<div class="stat avn-dieta-planejado"><small class="avn-dieta-card-titulo">Total planejado · '+esc(label)+'</small><strong><a href="#" class="avn-dieta-ranking-link" data-ranking-dieta="'+esc(key)+'" aria-label="Classificar alimentos por '+esc(label.toLowerCase())+'">'+plannedText+'</a></strong>'+
   (partial?'<small class="avn-dieta-card-nota">Parcial: faltam dados em alguns alimentos.</small>':'')+'</div></div>';
 }).join('');
 $('listaDieta').querySelectorAll('[data-plano]').forEach(btn=>btn.onclick=async()=>{if(!confirm('Excluir item da dieta programada?'))return;try{await send('/dieta/'+state.usuarioId+'/itens/'+btn.dataset.plano,'DELETE');await loadDiet();show('Item removido da programação.');}catch(e){show(e.message,true);}});
 $('listaDieta').querySelectorAll('[data-editar-plano]').forEach(link=>link.onclick=e=>{
  e.preventDefault();const item=rows.find(i=>String(i.id)===link.dataset.editarPlano);if(!item)return;
  abrirEdicaoDieta(item);
 });
}
function abrirEdicaoDieta(item){
 const row=[...$('listaDieta').querySelectorAll('[data-dieta-item]')].find(el=>el.dataset.dietaItem===String(item.id));
 if(!row)return;
 const original=row.innerHTML;
 const foods=state.alimentos.map(f=>'<option value="'+esc(f.id)+'"'+(String(f.id)===String(item.alimento_id)?' selected':'')+'>'+esc(f.nome)+(f.preparo?' · '+esc(f.preparo):'')+'</option>').join('');
 // Alimento previamente cadastrado pode ter sido desativado após a programação.
 const missing=!state.alimentos.some(f=>String(f.id)===String(item.alimento_id));
 const current=missing?'<option value="'+esc(item.alimento_id)+'" selected>'+esc(item.alimento_nome)+' (atual)</option>':'';
 row.innerHTML='<form class="avn-dieta-edicao">'+
  '<label class="avn-field">Alimento<select name="alimento_id" required>'+current+foods+'</select></label>'+
  '<label class="avn-field">Refeição<select name="refeicao">'+Object.entries(MEALS).map(([id,label])=>'<option value="'+esc(id)+'"'+(id===item.refeicao?' selected':'')+'>'+esc(label)+'</option>').join('')+'</select></label>'+
  '<label class="avn-field">Quantidade (g)<input name="quantidade_g" type="number" min="0.1" max="10000" step="any" required value="'+esc(item.quantidade_g)+'"></label>'+
  '<div class="avn-dieta-edicao-acoes"><button type="submit" class="primary">Salvar</button><button type="button" class="secondary" data-cancelar-edicao>Cancelar</button></div></form>';
 const form=row.querySelector('form');
 form.querySelector('[data-cancelar-edicao]').onclick=()=>renderDiet();
 form.onsubmit=async e=>{
  e.preventDefault();const btn=form.querySelector('button[type=submit]');btn.disabled=true;
  try{
   await send('/dieta/'+state.usuarioId+'/itens/'+item.id,'PUT',{
    alimento_id:form.elements.alimento_id.value,
    refeicao:form.elements.refeicao.value,
    quantidade_g:Number(form.elements.quantidade_g.value)
   });
   await loadDiet();show('Alimento planejado atualizado.');
  }catch(error){show(error.message,true);btn.disabled=false;}
 };
}

/* Importação assistida de alimentos da refeição programada, sem registrar consumo. */
let dietaImportacaoRevision=0,dietaImportacaoPendente=false,dietaSalvandoImportacao=false,dietaCatalogoImportacao=[];
function invalidarImportacaoDieta(limparTexto=false){
 dietaImportacaoRevision++;
 $('dietaRevisaoImportacao').replaceChildren();
 $('dietaRevisaoImportacao').hidden=true;
 $('dietaAplicarImportacao').hidden=true;
 $('dietaStatusImportacao').textContent='';
 if(limparTexto)$('dietaTextoIngredientes').value='';
}
function destinoImportacaoDieta(){
 $('dietaDestinoImportacao').textContent='Dieta padrão · '+(MEALS[v('dietaRefeicao')]||'Escolha uma refeição');
}
function abrirModalAdicionarNaRefeicao(refeicao){
 if(!MEALS[refeicao])return;
 userGuard();
 const modal=$('modalAdicionarRefeicaoDieta'), seletor=$('dietaRefeicao');
 modal.dataset.valorAnterior=seletor.value;
 $('anexoFormularioRefeicaoDieta').appendChild($('conteudoFormularioDieta'));
 seletor.value=refeicao;
 const campo=seletor.closest('label');
 campo.hidden=true;
 campo.parentElement.style.gridTemplateColumns='1fr';
 invalidarImportacaoDieta(true);
 destinoImportacaoDieta();
 $('tituloAdicionarRefeicaoDieta').textContent='➕ Adicionar alimento · '+MEALS[refeicao];
 modal.showModal();
}
function devolverFormularioDieta(){
 const modal=$('modalAdicionarRefeicaoDieta'), seletor=$('dietaRefeicao');
 $('modalAdicionarDieta').appendChild($('conteudoFormularioDieta'));
 const campo=seletor.closest('label');
 campo.hidden=false;
 campo.parentElement.style.gridTemplateColumns='';
 seletor.value=modal.dataset.valorAnterior||'almoco';
 delete modal.dataset.valorAnterior;
 invalidarImportacaoDieta(true);
 destinoImportacaoDieta();
}
function opcoesAlimentosDieta(alimentoId){
 return '<option value="">Selecione o alimento</option>'+dietaCatalogoImportacao.map(f=>'<option value="'+esc(f.id)+'"'+(String(f.id)===String(alimentoId)?' selected':'')+'>'+esc(f.nome)+(f.preparo?' · '+esc(f.preparo):'')+(f.marca?' · '+esc(f.marca):'')+'</option>').join('');
}
function renderImportacaoDieta(itens){
 const area=$('dietaRevisaoImportacao');
 area.replaceChildren();
 for(const item of itens){
  const gramas=Number(item.gramas);
  const pesoValido=item.gramas!==null&&item.gramas!==undefined&&Number.isFinite(gramas)&&gramas>0&&gramas<=10000;
  const confiavel=item.confianca==='alta'&&!!item.alimento_id&&pesoValido;
  const linha=document.createElement('div');
  linha.className='importador-item'+(confiavel?'':' revisar');
  linha.innerHTML='<p class="linha-original">'+esc(item.linha)+'</p>'+
   '<label class="incluir"><input class="dieta-incluir-revisao" type="checkbox"'+(confiavel?' checked':'')+'> Incluir</label>'+
   '<label class="avn-field">Alimento do cadastro<select class="dieta-alimento-revisao">'+opcoesAlimentosDieta(item.alimento_id)+'</select></label>'+
   '<label class="avn-field campo-peso">Peso estimado (g)<input class="dieta-peso-revisao" type="number" min="0.001" max="10000" step="any" value="'+(pesoValido?esc(gramas):'')+'" placeholder="'+(gramas>10000?'Verifique a unidade':'Informe o peso')+'"></label>'+
   '<p class="obs">'+esc(item.observacao||'Confira alimento e peso.')+(pesoValido?'':' Peso não confirmado: informe entre 0 e 10.000 g.')+'</p>';
  area.appendChild(linha);
 }
 area.hidden=false;
 $('dietaAplicarImportacao').hidden=false;
 $('dietaStatusImportacao').textContent=itens.length+' ingrediente(s) identificados. Confira alimento e peso; somente os marcados serão adicionados.';
}
async function interpretarIngredientesDieta(){
 if(dietaImportacaoPendente||dietaSalvandoImportacao)return;
 const texto=v('dietaTextoIngredientes').trim();
 if(!texto){$('dietaStatusImportacao').textContent='Cole os ingredientes, um por linha.';return;}
 try{userGuard();}catch(e){$('dietaStatusImportacao').textContent=e.message;return;}
 const revision=++dietaImportacaoRevision;
 const usuario=state.usuarioId;
 const dia=state.dias;
 const refeicao=v('dietaRefeicao');
 $('dietaRevisaoImportacao').hidden=true;
 $('dietaAplicarImportacao').hidden=true;
 dietaImportacaoPendente=true;
 $('dietaInterpretarIngredientes').disabled=true;
 $('dietaStatusImportacao').textContent='Identificando ingredientes e estimando quantidades…';
 try{
  const [catalogo,resposta]=await Promise.all([
   api('/receitas/catalogo?usuarioId='+encodeURIComponent(usuario)),
   send('/receitas/interpretar','POST',{usuarioId:usuario,texto})
  ]);
  if(revision!==dietaImportacaoRevision||usuario!==state.usuarioId||dia!==state.dias||refeicao!==v('dietaRefeicao')||texto!==v('dietaTextoIngredientes').trim())return;
  if(!Array.isArray(catalogo)||!Array.isArray(resposta.itens)||!resposta.itens.length)throw Error('A IA não retornou ingredientes válidos.');
  dietaCatalogoImportacao=catalogo;
  renderImportacaoDieta(resposta.itens);
 }catch(e){if(revision===dietaImportacaoRevision)$('dietaStatusImportacao').textContent=e.message;}
 finally{dietaImportacaoPendente=false;$('dietaInterpretarIngredientes').disabled=false;}
}
async function aplicarIngredientesDieta(){
 if(dietaImportacaoPendente||dietaSalvandoImportacao)return;
 const rows=[...$('dietaRevisaoImportacao').querySelectorAll('.importador-item')];
 const escolhidos=rows.filter(row=>row.querySelector('.dieta-incluir-revisao').checked);
 if(!escolhidos.length){$('dietaStatusImportacao').textContent='Marque ao menos um ingrediente.';return;}
 const itens=[];
 for(const row of escolhidos){
  const alimentoId=row.querySelector('.dieta-alimento-revisao').value;
  const input=row.querySelector('.dieta-peso-revisao');
  const quantidade=Number(input.value);
  if(!alimentoId||!input.value||!input.checkValidity()||!Number.isFinite(quantidade)||quantidade<=0||quantidade>10000){
   row.classList.add('revisar');
   $('dietaStatusImportacao').textContent='Corrija alimento e gramagem de todos os ingredientes marcados.';
   input.focus();return;
  }
  itens.push({alimento_id:alimentoId,quantidade_g:quantidade});
 }
 const usuario=state.usuarioId;
 const dia=state.dias;
 const refeicao=v('dietaRefeicao');
 const botao=$('dietaAplicarImportacao');
 const locks=['usuario','dietaRefeicao','dietaTextoIngredientes','dietaInterpretarIngredientes'];
 dietaSalvandoImportacao=true;
 botao.disabled=true;
 locks.forEach(id=>$(id).disabled=true);
 $('dietaStatusImportacao').textContent='Salvando '+itens.length+' alimento(s) na refeição…';
 try{
  userGuard();
  const resposta=await send('/dieta/'+encodeURIComponent(usuario)+'/itens/lote','POST',{refeicao,itens});
  invalidarImportacaoDieta(true);
  await loadDiet();
  const mensagem=(resposta.inseridos||itens.length)+' alimento(s) adicionados a '+(MEALS[refeicao]||refeicao)+' de '+DAYS[dia]+'.';
  $('dietaStatusImportacao').textContent=mensagem;
  show(mensagem);
 }catch(e){$('dietaStatusImportacao').textContent=e.message;show(e.message,true);}
 finally{dietaSalvandoImportacao=false;botao.disabled=false;locks.forEach(id=>$(id).disabled=false);}
}
 
/* Registro assistido de UMA refeição planejada; não modifica a programação. */
let registrandoRefeicao=false;
function renderPlannedMeal(){
 if(!has('refeicaoPlanejada'))return;
 const seletor=$('refeicaoPlanejada');
 const items=state.dieta;
 const keys=Object.keys(MEALS).filter(k=>items.some(i=>i.refeicao===k));
 const previous=seletor.value;
 seletor.innerHTML='<option value="">Escolha uma refeição</option>'+
  keys.map(k=>'<option value="'+esc(k)+'">'+esc(MEALS[k])+'</option>').join('');
 seletor.value=keys.includes(previous)?previous:'';
 const area=$('itensRefeicaoPlanejada'), button=$('registrarRefeicao');
 button.disabled=true;
 if(!keys.length){
  area.innerHTML='<p class="muted">Não há refeições na dieta programada.</p>';
  return;
 }
 if(!seletor.value){
  area.innerHTML='<p class="muted">Escolha uma refeição para conferir os alimentos antes do registro.</p>';
  return;
 }
 const mealItems=items.filter(i=>i.refeicao===seletor.value);
 const registrados=new Set(state.diario.filter(i=>i.plano_item_id!=null).map(i=>String(i.plano_item_id)));
 const newItems=mealItems.filter(i=>!registrados.has(String(i.id)));
 area.innerHTML='<p class="avn-refeicao-resumo">'+esc(MEALS[seletor.value])+' · '+mealItems.length+' alimento(s) · '+(mealItems.length-newItems.length)+' já registrado(s)</p>'+
  mealItems.map(i=>{
   const ja=registrados.has(String(i.id));
   const cal=i.kcal_100g==null?'Energia não informada':fmt(Number(i.kcal_100g)*Number(i.quantidade_g)/100,0)+' kcal planejadas';
   return '<div class="avn-refeicao-item'+(ja?' ja-registrado':'')+'" data-plano-item="'+esc(i.id)+'">'+
    '<label class="avn-refeicao-nome"><input type="checkbox" class="avn-refeicao-marcar" '+(ja?'disabled':'checked')+'><span><strong>'+esc(i.alimento_nome)+'</strong><small>'+esc(ja?'Já registrado neste dia':cal)+'</small></span></label>'+
    '<label class="avn-field">Quantidade consumida (g)<input class="avn-refeicao-gramas" type="number" min="0.1" max="10000" step="any" value="'+esc(i.quantidade_g)+'" '+(ja?'disabled':'')+'></label>'+
    '</div>';
  }).join('');
 if(newItems.length===0){
  area.insertAdjacentHTML('beforeend','<p class="muted">Todos os itens dessa refeição já foram registrados neste dia.</p>');
 }
 const change=()=>{button.disabled=registrandoRefeicao||!area.querySelector('.avn-refeicao-marcar:checked');};
 area.querySelectorAll('.avn-refeicao-marcar').forEach(box=>box.addEventListener('change',change));
 change();
}
async function registrarRefeicaoPlanejada(){
 if(registrandoRefeicao)return;
 try{
  userGuard();
  const userId=state.usuarioId,data=state.data,refeicao=v('refeicaoPlanejada');
  if(!refeicao)throw Error('Escolha a refeição programada.');
  const lista=[...$('itensRefeicaoPlanejada').querySelectorAll('.avn-refeicao-item')];
  const selecionados=lista.filter(row=>row.querySelector('.avn-refeicao-marcar').checked);
  if(!selecionados.length)throw Error('Marque os alimentos realmente consumidos.');
  const itens=selecionados.map(row=>{
   const input=row.querySelector('.avn-refeicao-gramas');
   const peso=Number(input.value);
   if(!input.value||!input.checkValidity()||!Number.isFinite(peso)||peso<=0||peso>10000){
    input.focus();
    throw Error('Corrija o peso consumido de '+row.querySelector('strong').textContent+'.');
   }
   return {plano_item_id:row.dataset.planoItem,quantidade_g:peso};
  });
  registrandoRefeicao=true;
  $('registrarRefeicao').disabled=true;
  const resposta=await send('/diario/'+userId+'/registrar-refeicao','POST',{data,refeicao,itens});
  if(userId===state.usuarioId&&data===state.data){
   await loadDaily();
    $('modalAdicionarDiario').close();
    show(resposta.inseridos+' alimento(s) registrado(s) em '+MEALS[refeicao]+'.'+
    (resposta.ja_registrados?' '+resposta.ja_registrados+' já estavam registrados; nenhum duplicado.':''));
  }else show('Registro salvo. Volte à data e ao usuário anteriores para visualizá-lo.');
 }catch(e){show(e.message,true);}
 finally{registrandoRefeicao=false;renderPlannedMeal();}
}

function renderFoodList(){
 if(!has('listaAlimentos'))return;
 const q=($('buscaAlimento').value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 const list=state.alimentos.filter(f=>(f.nome+' '+(f.preparo||'')+' '+(f.marca||'')).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().includes(q));
 $('listaAlimentos').innerHTML=list.length?list.map(f=>`<div class="list-row avn-food-row" data-food-id="${f.id}" tabindex="0" role="button" aria-label="Ver composição de ${esc(f.nome)}"><div><span class="name">${esc(f.nome)}</span><small>${esc([f.preparo,f.marca].filter(Boolean).join(' · '))} ${f.kcal_100g==null?'· Energia sem dado':'· '+fmt(f.kcal_100g,1)+' kcal/100 g'}</small></div><div class="avn-food-actions"><button type="button" class="secondary" data-edit="${f.id}">Editar</button>${String(f.usuario_id)===String(state.usuarioId)&&f.fonte!=='receita'? `<button type="button" class="delete" data-delete-food="${f.id}" aria-label="Excluir ${esc(f.nome)}">Excluir</button>`:''}</div></div>`).join(''):'<p class="muted">Nenhum alimento encontrado. Cadastre o primeiro alimento no formulário.</p>';
 $('listaAlimentos').querySelectorAll('[data-edit]').forEach(btn=>btn.onclick=e=>{e.stopPropagation();fillFood(state.alimentos.find(a=>String(a.id)===btn.dataset.edit));$('modalAlimento').showModal();});
 $('listaAlimentos').querySelectorAll('[data-delete-food]').forEach(btn=>btn.onclick=async e=>{e.stopPropagation();await excluirAlimento(btn.dataset.deleteFood,btn);});
 $('listaAlimentos').querySelectorAll('[data-food-id]').forEach(row=>{const abrir=()=>window.AVNFoodCharts?.open(state.alimentos.find(a=>String(a.id)===row.dataset.foodId),MICRO);row.addEventListener('click',e=>{if(e.target.closest('button'))return;abrir();});row.addEventListener('keydown',e=>{if(e.target===row&&(e.key==='Enter'||e.key===' ')){e.preventDefault();abrir();}});});
}
async function excluirAlimento(id,button){
 const alimento=state.alimentos.find(f=>String(f.id)===String(id));
 if(!alimento||String(alimento.usuario_id)!==String(state.usuarioId))return;
 if(!confirm('Excluir o alimento "'+alimento.nome+'" do catálogo? Se já estiver em uso, a exclusão será bloqueada.'))return;
 button.disabled=true;
 try{
  userGuard();
  await send('/alimentos/'+encodeURIComponent(id)+'?usuarioId='+encodeURIComponent(state.usuarioId),'DELETE');
  if(has('alimentoId')&&String(v('alimentoId'))===String(id)){fillFood(null);$('modalAlimento').close();}
  await loadFoods();
  show('Alimento excluído do catálogo.');
 }catch(e){show(e.message,true);button.disabled=false;}
}
function fillFood(f){
 state.origemImportacao=null;
 $('formAlimento').reset();$('tituloAlimento').textContent=f?'Editar alimento':'Novo alimento';$('alimentoId').value=f?.id||'';
 $('alimentoNome').value=f?.nome||'';$('alimentoMarca').value=f?.marca||'';$('alimentoPreparo').value=f?.preparo||'';
 $('porcaoNome').value=f?.porcao_nome||'';$('porcaoGramas').value=f?.porcao_gramas||'';
 for(const [key] of MACROS)$('alim_'+key).value=f?.[key+'_100g']??'';
 for(const [key] of MICRO)$('micro_'+key).value=f?.micronutrientes_100g?.[key]??'';
 if(f)$('formAlimento').scrollIntoView({behavior:'smooth',block:'start'});
}
function numberOrNull(id){const x=v(id);if(x==='')return null;const n=Number(x);if(!Number.isFinite(n)||n<0)throw Error('Valor inválido: '+id);return n;}
function getMicros(prefix){const data={};for(const [key] of MICRO){const value=numberOrNull(prefix+'_'+key);if(value!==null)data[key]=value;}return data;}
function fillGoals(){if(!has('camposMetas'))return;for(const [key] of MACROS)$('meta_'+key).value=state.metas[key]??'';for(const [key] of MICRO)$('metamicro_'+key).value=state.metas.micros?.[key]??'';atualizarResumoEnergiaMetas();}

let metaPendente=null;
let historicoMetas=[];
function selecionarAbaMetas(aba,focus=false){
 if(PAGE!=='metas')return;
 const micros=aba==='micros';
 const ativo=micros?'abaMicrosMetas':'abaCaloriasMetas',inativo=micros?'abaCaloriasMetas':'abaMicrosMetas';
 $(ativo).classList.add('active');$(ativo).setAttribute('aria-selected','true');$(ativo).tabIndex=0;
 $(inativo).classList.remove('active');$(inativo).setAttribute('aria-selected','false');$(inativo).tabIndex=-1;
 $('painelMetasMicros').hidden=!micros;$('painelMetasCalorias').hidden=micros;
 if(focus)$(ativo).focus();
}
function atualizarResumoEnergiaMetas(){
 if(PAGE!=='metas'||!has('resumoEnergiaMetas'))return;
 const chave=['proteinas_g','carboidratos_g','gorduras_g'];
 if(chave.some(k=>$('meta_'+k).value==='')){$('resumoEnergiaMetas').textContent='Preencha proteínas, carboidratos e gorduras para calcular as calorias correspondentes.';return;}
 const p=Number(v('meta_proteinas_g')),c=Number(v('meta_carboidratos_g')),g=Number(v('meta_gorduras_g'));
 if([p,c,g].some(x=>!Number.isFinite(x)||x<0)){$('resumoEnergiaMetas').textContent='Confira os valores de macronutrientes.';return;}
 const kcal=p*4+c*4+g*9;
 const alvo=v('meta_kcal')===''?null:Number(v('meta_kcal'));
 $('resumoEnergiaMetas').textContent='Energia calculada pelos macros: '+fmt(kcal,1)+' kcal'+
  (alvo===null?' · Informe uma meta energética.':' · Diferença para a meta: '+fmt(kcal-alvo,1)+' kcal (calculada − definida).');
}
function calcularPreviaGkg(){
 const pesoTexto=v('pesoCalculadoraGkg');
 const peso=pesoTexto===''?NaN:Number(pesoTexto);
 const taxas=[v('gkgProteinas'),v('gkgCarboidratos'),v('gkgGorduras')];
 const nums=taxas.map(x=>x===''?NaN:Number(x));
 const ok=Number.isFinite(peso)&&peso>=1&&peso<=500&&nums.every(n=>Number.isFinite(n)&&n>=0&&n<=10);
 $('aplicarCalculadoraGkg').disabled=!ok;
 if(!ok){$('previaCalculadoraGkg').textContent='Informe um peso válido e taxas entre 0 e 10 g/kg.';return null;}
 const macros=Object.fromEntries(['proteinas_g','carboidratos_g','gorduras_g'].map((k,i)=>[k,Math.round((peso*nums[i]+Number.EPSILON)*100)/100]));
 const kcal=macros.proteinas_g*4+macros.carboidratos_g*4+macros.gorduras_g*9;
 if(Object.values(macros).some(n=>n>1000)||kcal>12000){
  $('aplicarCalculadoraGkg').disabled=true;
  $('previaCalculadoraGkg').textContent='O cálculo ultrapassa os limites de metas do AVN. Reduza o peso ou as taxas.';
  return null;
 }
 const alvo=v('meta_kcal')===''?null:Number(v('meta_kcal'));
 const rows=[['Proteínas',macros.proteinas_g],['Carboidratos',macros.carboidratos_g],['Gorduras',macros.gorduras_g]];
 $('previaCalculadoraGkg').innerHTML=rows.map(([nome,valor])=>
  '<div class="list-row"><span>'+nome+'</span><strong>'+fmt(valor,2)+' g/dia</strong></div>').join('')+
  '<p><strong>'+fmt(kcal,1)+' kcal/dia</strong> calculadas pelos macros'+
  (alvo===null?'':'; diferença para a meta atual: '+fmt(kcal-alvo,1)+' kcal')+'.</p>';
 return {peso_kg:peso,macros,energia:kcal,taxas_gkg:{proteinas_g:nums[0],carboidratos_g:nums[1],gorduras_g:nums[2]}};
}
async function abrirCalculadoraGkg(){
 userGuard();
 $('modalCalculadoraGkg').showModal();
 $('origemPesoCalculadora').textContent='Consultando última pesagem…';
 $('pesoCalculadoraGkg').value='';
 calcularPreviaGkg();
 const uid=state.usuarioId;
 try{
  const peso=await api('/metas/'+uid+'/peso');
  if(uid!==state.usuarioId||!$('modalCalculadoraGkg').open)return;
  const w=peso.peso_kg==null?null:Number(peso.peso_kg);
  $('origemPesoCalculadora').textContent=w==null?'Nenhuma pesagem encontrada. Informe seu peso manualmente.':
   'Última pesagem registrada: '+fmt(w,2)+' kg'+(peso.data_medicao?' · '+new Date(peso.data_medicao).toLocaleDateString('pt-BR'):'')+'. Pode alterar o valor.';
  if(w!==null&&w>=1&&w<=500){
   $('pesoCalculadoraGkg').value=w;
   for(const [key,id] of [['proteinas_g','gkgProteinas'],['carboidratos_g','gkgCarboidratos'],['gorduras_g','gkgGorduras']]){
    const m=state.metas[key];if(m!=null)$(id).value=(Number(m)/w).toFixed(2);
   }
  }
  calcularPreviaGkg();
 }catch(err){$('origemPesoCalculadora').textContent=err.message+' Informe o peso manualmente.';}
}
function aplicarCalculadoraGkg(){
 const calculo=calcularPreviaGkg();
 if(!calculo)return;
 for(const [key,n] of Object.entries(calculo.macros))$('meta_'+key).value=n;
 if(v('meta_kcal')==='')$('meta_kcal').value=Math.round(calculo.energia*100)/100;
 metaPendente={origem:'calculadora_gkg',peso_kg:calculo.peso_kg,taxas_gkg:calculo.taxas_gkg};
 $('modalCalculadoraGkg').close();
 selecionarAbaMetas('calorias');
 atualizarResumoEnergiaMetas();
 show('Macros preenchidos. Confira as calorias e clique em Salvar metas para registrar no histórico.');
}
function renderHistoricoMetas(){
 if(!historicoMetas.length){$('listaHistoricoMetas').innerHTML='<p class="muted">Nenhuma meta salva ainda.</p>';return;}
 $('listaHistoricoMetas').innerHTML=historicoMetas.map(h=>{
  const data=new Date(h.criado_em).toLocaleString('pt-BR');
  const gkg=(nome,gramas,razao)=>gramas==null?'—':fmt(gramas,2)+' g'+(razao==null?'':' · '+fmt(razao,3)+' g/kg');
  const origem={manual:'Manual',calculadora_gkg:'Calculadora g/kg',ia:'Sugestão de IA',restauracao:'Restauração',legado:'Meta anterior'}[h.origem]||h.origem;
  return '<article><h4>'+esc(data)+' · '+esc(origem)+'</h4>'+
   '<p class="muted">Peso: '+(h.peso_kg==null?'Não registrado':fmt(h.peso_kg,2)+' kg')+
   ' · Energia definida: '+(h.kcal==null?'—':fmt(h.kcal,1)+' kcal')+
   ' · Energia dos macros: '+(h.energia_macros_kcal==null?'—':fmt(h.energia_macros_kcal,1)+' kcal')+'</p>'+
   '<div class="avn-two"><div><strong>Proteínas:</strong> '+gkg('Proteínas',h.proteinas_g,h.proteinas_g_kg)+'</div>'+
   '<div><strong>Carboidratos:</strong> '+gkg('Carboidratos',h.carboidratos_g,h.carboidratos_g_kg)+'</div>'+
   '<div><strong>Gorduras:</strong> '+gkg('Gorduras',h.gorduras_g,h.gorduras_g_kg)+'</div>'+
   '<div><strong>Fibras:</strong> '+(h.fibras_g==null?'—':fmt(h.fibras_g,2)+' g')+'</div></div>'+
   '<p class="muted">Micronutrientes com meta: '+Object.keys(h.micros||{}).length+'</p>'+
   '<button class="secondary" type="button" data-restaurar-meta="'+esc(h.id)+'">Restaurar esta meta</button></article>';
 }).join('');
}
async function abrirHistoricoMetas(){
 userGuard();
 $('modalHistoricoMetas').showModal();
 $('listaHistoricoMetas').textContent='Carregando histórico…';
 const uid=state.usuarioId;
 try{
  const h=await api('/metas/'+uid+'/historico?limite=50');
  if(uid!==state.usuarioId||!$('modalHistoricoMetas').open)return;
  historicoMetas=h.registros||[];
  renderHistoricoMetas();
 }catch(e){$('listaHistoricoMetas').textContent=e.message;}
}
function restaurarMeta(id){
 const h=historicoMetas.find(item=>String(item.id)===String(id));
 if(!h)return;
 for(const [key] of MACROS)$('meta_'+key).value=h[key]??'';
 for(const [key] of MICRO)$('metamicro_'+key).value=h.micros?.[key]??'';
 metaPendente={origem:'restauracao',peso_kg:h.peso_kg??null,taxas_gkg:h.proteinas_g_kg==null||h.carboidratos_g_kg==null||h.gorduras_g_kg==null?null:{proteinas_g:Number(h.proteinas_g_kg),carboidratos_g:Number(h.carboidratos_g_kg),gorduras_g:Number(h.gorduras_g_kg)}};
 $('modalHistoricoMetas').close();
 selecionarAbaMetas('calorias');
 atualizarResumoEnergiaMetas();
 show('Meta histórica preenchida. Clique em Salvar metas para ativá-la e registrar uma nova versão.');
}

async function loadFoods(){state.alimentos=await api('/alimentos?usuarioId='+state.usuarioId);selectFoods();renderFoodList();}
async function loadGoals(){state.metas=await api('/metas/'+state.usuarioId);metaPendente=null;fillGoals();}
async function loadDiet(){const r=await api('/dieta/'+state.usuarioId);state.dieta=r.itens||[];state.perfis=r.perfis||[];renderDiet();renderPlannedMeal();}
async function loadDaily(){const r=await api('/diario/'+state.usuarioId+'?data='+state.data);state.diario=r.itens;renderDaily();renderPlannedMeal();}
async function reload(){
 if(!state.usuarioId){state.alimentos=[];state.diario=[];state.dieta=[];state.perfis=[];state.metas={};selectFoods();renderFoodList();renderDiet();renderDaily();fillGoals();return;}
 if(PAGE==='diario')await Promise.all([loadFoods(),loadGoals(),loadDiet(),loadDaily()]);
 if(PAGE==='dieta'){await Promise.all([loadFoods(),loadGoals(),loadDiet(),loadDaily()]);renderDiet();}
 if(PAGE==='alimentos')await loadFoods();
 if(PAGE==='metas')await loadGoals();
}
async function startUsers(){
 const r=await fetch('/api/avn/usuarios',{credentials:'same-origin'});if(!r.ok)throw Error('Não foi possível consultar usuários cadastrados.');const users=await r.json();
 const remembered=localStorage.getItem('avn_nutricao_usuario')||localStorage.getItem('avn_treinos_usuario')||'';
 state.usuarioId=users.some(u=>String(u.id)===remembered)?remembered:String(users[0]?.id||'');
 $('usuario').innerHTML='<option value="">Selecione usuário</option>'+users.map(u=>`<option value="${u.id}">${esc(u.nome)}</option>`).join('');$('usuario').value=state.usuarioId;
 if(!state.usuarioId){show('Cadastre um usuário na Central AVN antes de registrar alimentos.',true);return;}
 localStorage.setItem('avn_nutricao_usuario',state.usuarioId);await reload();
}
function configurarIA(){
 if(!window.AVNComparadorAlimentos)throw Error('Comparador nutricional não foi carregado. Atualize a página.');
 window.AVNComparadorAlimentos.iniciar({
  api,send,esc,fmt,MACROS,getMicros:()=>MICRO,
  aplicar(d,fonte){
   // Selecionar resultado não grava nada no banco: preenche o formulário para revisão.
   fillFood(null);
   const nome=String(d.nome||d.descricao||'').trim();
   $('alimentoNome').value=nome;
   $('alimentoMarca').value=String(d.marca||'');
   $('alimentoPreparo').value=String(d.preparo||'');
   state.origemImportacao={fonte,fonte_referencia:fonte==='ia_pesquisa'
    ?(Array.isArray(d.fontes)?d.fontes.find(x=>x.url&&x.url.length<=240)?.url:'')||''
    :String(d.fonteUrl||d.fonte_referencia||'')};
   for(const [key] of MACROS)$('alim_'+key).value=d.macros?.[key]??'';
   for(const [key] of MICRO)$('micro_'+key).value=d.micros?.[key]??'';
   show('Dados de '+({taco:'TACO',usda_fdc:'USDA',ia_pesquisa:'IA'}[fonte]||fonte)+' preenchidos. Confira nome, preparo e nutrientes, depois clique em Salvar alimento.');
   $('formAlimento').scrollIntoView({behavior:'smooth',block:'start'});
  }
 });
}


function microDieta(dados){
 return MICRO.map(([key,nome,unidade])=>({key,nome,unidade,valor:Number(dados.total[key]),parcial:dados.miss[key]>0})).filter(m=>Number.isFinite(m.valor)&&m.valor>0).sort((a,b)=>b.valor-a.valor||a.nome.localeCompare(b.nome,'pt-BR'));
}
function fmtMicroDieta(n){return n>0&&n<0.000001?n.toExponential(2).replace('.',','):fmt(n,9);}
function tabAnaliseDieta(tab){
 for(const t of ['Macros','Micros']){
  const ativo=t.toLowerCase()===tab;
  $('aba'+t+'Dieta').setAttribute('aria-selected',String(ativo));
  $('aba'+t+'Dieta').tabIndex=ativo?0:-1;
  $('painel'+t+'Dieta').hidden=!ativo;
 }
}
function abrirAnaliseNutricionalDieta(){
 const a=aggregate(state.dieta), macros=[
  {nome:'Proteínas',key:'proteinas_g',fator:4,cor:'#60a5fa'},
  {nome:'Carboidratos',key:'carboidratos_g',fator:4,cor:'#fbbf24'},
  {nome:'Gorduras',key:'gorduras_g',fator:9,cor:'#a78bfa'}
 ];
 const energia=macros.reduce((sum,m)=>sum+a.total[m.key]*m.fator,0);
 let anterior=0;
 const gradiente=macros.map(m=>{const p0=energia?anterior/energia*100:0;anterior+=a.total[m.key]*m.fator;return m.cor+' '+p0+'% '+(energia?anterior/energia*100:0)+'%';}).join(',');
 const anel=energia>0?'<div class="avn-meal-ring" role="img" aria-label="Distribuição energética de proteínas, carboidratos e gorduras" style="background:conic-gradient('+gradiente+')"></div>':'<p class="muted">Sem energia conhecida de macronutrientes para o gráfico.</p>';
 $('conteudoMacrosDieta').innerHTML='<p>Energia: <strong>'+(state.dieta.length&&a.miss.kcal===state.dieta.length?'Sem dado':fmt(a.total.kcal,0)+' kcal')+'</strong> · Fibras: '+(state.dieta.length&&a.miss.fibras_g===state.dieta.length?'Sem dado':fmt(a.total.fibras_g,2)+' g')+'</p>'+anel+
  '<div class="avn-meal-legend">'+macros.map(m=>'<div><i style="background:'+m.cor+'"></i>'+esc(m.nome)+': <strong>'+(state.dieta.length&&a.miss[m.key]===state.dieta.length?'Sem dado':fmt(a.total[m.key],2)+' g')+'</strong> · '+(energia?fmt(a.total[m.key]*m.fator*100/energia,1):'0')+'%'+(a.miss[m.key]?' (parcial)':'')+'</div>').join('')+'</div>'+
  (MACROS.some(([key])=>a.miss[key])?'<p class="muted">Os totais podem ser parciais quando faltam dados de alimentos.</p>':'')+
  '<p class="muted">Percentuais por energia: proteínas e carboidratos 4 kcal/g; gorduras 9 kcal/g.</p>';
 const micros=microDieta(a);
 $('conteudoMicrosDieta').innerHTML=micros.length?'<ul class="avn-dieta-micros-lista">'+micros.map(m=>'<li><span>'+esc(m.nome)+(m.parcial?' <small class="avn-dieta-parcial" title="Um ou mais alimentos sem informação deste nutriente">parcial</small>':'')+'</span><strong>'+fmtMicroDieta(m.valor)+' '+esc(m.unidade)+'</strong></li>').join('')+'</ul>'+(micros.some(m=>m.parcial)?'<p class="muted">Parcial: soma dos alimentos com informação conhecida; o valor real pode ser maior.</p>':''):'<p class="muted">Nenhum micronutriente com valor positivo cadastrado.</p>';
 tabAnaliseDieta('macros');$('modalAnaliseDieta').showModal();
}
function imprimirRelatorioDieta(){
 if(!state.dieta.length){show('Adicione alimentos à dieta antes de gerar o relatório.',true);return;}
 const a=aggregate(state.dieta);
 const macroRows=MACROS.map(([k,nome,unidade])=>'<tr><th>'+esc(nome)+'</th><td>'+(a.miss[k]===state.dieta.length?'Sem dado':fmt(a.total[k],k==='kcal'?0:2)+' '+esc(unidade)+(a.miss[k]?' (parcial)':''))+'</td></tr>').join('');
 const microRows=microDieta(a).map(m=>'<tr><th>'+esc(m.nome)+'</th><td>'+fmtMicroDieta(m.valor)+' '+esc(m.unidade)+(m.parcial?' (parcial)':'')+'</td></tr>').join('');
 const refeicoes=Object.entries(MEALS).map(([key,nome])=>{
  const itens=state.dieta.filter(i=>i.refeicao===key);if(!itens.length)return '';
  const subtotal=aggregate(itens);
  return '<section><h2>'+esc(nome)+'</h2><table><thead><tr><th>Alimento</th><th>Quantidade</th><th>Energia</th></tr></thead><tbody>'+itens.map(i=>{
   const c=i.composicao_100g||composition(i);
   return '<tr><td>'+esc(i.alimento_nome||'Alimento')+'</td><td>'+fmt(i.quantidade_g,2)+' g</td><td>'+(c.kcal==null?'Sem dado':fmt(Number(c.kcal)*Number(i.quantidade_g)/100,0)+' kcal')+'</td></tr>';
  }).join('')+'</tbody></table><p class="info">Subtotal: '+fmt(subtotal.total.kcal,0)+' kcal'+(subtotal.miss.kcal?' (parcial)':'')+'</p></section>';
 }).join('');
 const usuario=$('usuario').selectedOptions[0]?.textContent?.trim()||'Usuário AVN';
 const pagina='<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Dieta programada · AVN</title><style>'+
  '@page{size:A4;margin:16mm}body{font:12px/1.5 Arial,sans-serif;color:#142638;margin:0}h1{font-size:24px;margin:0}h2{font-size:16px;border-bottom:1px solid #ccd5df;padding-bottom:5px;margin:21px 0 8px}p{margin:4px 0 8px}table{width:100%;border-collapse:collapse;margin:7px 0}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #dfe5ea}td:nth-child(n+2){text-align:right}thead{background:#eef4f8}.cabecalho{border-bottom:2px solid #1b6188;padding-bottom:12px}.info,.aviso{color:#596775;font-size:11px}.aviso{border-top:1px solid #ccd5df;margin-top:20px;padding-top:10px}section,tr{break-inside:avoid}.no-print{background:#eef4f8;padding:12px;margin-bottom:12px}@media print{.no-print{display:none}}'+
  '</style></head><body><div class="no-print">Para baixar o relatório em PDF, selecione <strong>Salvar como PDF</strong> na janela de impressão.</div><div class="cabecalho"><h1>Dieta programada · AVN</h1><p>Dieta padrão válida para todos os dias · '+esc(usuario)+'</p><p>Gerado em '+esc(new Date().toLocaleString('pt-BR'))+'</p></div><h2>Resumo nutricional planejado</h2><table><tbody>'+macroRows+'</tbody></table>'+refeicoes+
  '<h2>Micronutrientes conhecidos (maiores que zero)</h2>'+(microRows?'<table><tbody>'+microRows+'</tbody></table>':'<p>Nenhum micronutriente positivo informado.</p>')+
  '<p class="aviso">Valores estimados conforme dados dos alimentos cadastrados. Parcial indica que faltam dados em um ou mais alimentos. A programação não comprova o consumo.</p></body></html>';
 const janela=window.open('','_blank');
 if(!janela){show('Permita pop-ups para abrir a impressão do relatório.',true);return;}
 janela.opener=null;janela.document.open();janela.document.write(pagina);janela.document.close();janela.focus();
 janela.setTimeout(()=>{if(!janela.closed)janela.print();},350);
}

let editandoConsumoId=null;
// Ordena a contribuição da porção cadastrada na dieta, nunca valores por 100g.
function montarRankingDieta(chave){
 const macro=MACROS.slice(0,4).find(([key])=>key===chave);
 if(!macro)return null;
 const [key,label,unit]=macro;
 const itens=state.dieta.map(item=>{
  const dados=aggregate([item]);
  return {item,valor:dados.miss[key]?null:dados.total[key]};
 }).sort((a,b)=>{
  if(a.valor===null)return b.valor===null?a.item.alimento_nome.localeCompare(b.item.alimento_nome,'pt-BR'):1;
  if(b.valor===null)return -1;
  return b.valor-a.valor||a.item.alimento_nome.localeCompare(b.item.alimento_nome,'pt-BR');
 });
 return {key,label,unit,itens};
}
function abrirRankingDieta(chave){
 const ranking=montarRankingDieta(chave);
 if(!ranking||!has('modalRankingDieta'))return;
 $('tituloRankingDieta').textContent='Alimentos com mais '+ranking.label.toLowerCase();
 const conhecidos=ranking.itens.filter(x=>x.valor!==null);
 const total=conhecidos.reduce((s,x)=>s+x.valor,0);
 $('conteudoRankingDieta').innerHTML=ranking.itens.length?
  '<p class="muted">Contribuição de cada porção da dieta programada, em ordem decrescente. Alimentos sem dados aparecem ao final.</p>'+
  '<ol class="avn-dieta-ranking-lista">'+ranking.itens.map(({item,valor},i)=>{
   const percentual=valor===null||total<=0?'':fmt(valor/total*100,1)+'% do total conhecido';
   return '<li><div class="avn-dieta-ranking-item">'+
    '<span class="avn-dieta-ranking-pos">'+(i+1)+'º</span>'+
    '<span class="avn-dieta-ranking-food"><strong>'+esc(item.alimento_nome)+' <span aria-hidden="true">'+emojiAlimento(item.alimento_nome)+'</span></strong>'+
    '<small>'+esc(MEALS[item.refeicao]||item.refeicao)+' · '+fmt(item.quantidade_g,1)+' g</small></span>'+
    '<span class="avn-dieta-ranking-valor"><strong>'+(valor===null?'Sem dado':fmt(valor,ranking.key==='kcal'?0:1)+' '+esc(ranking.unit))+'</strong>'+
    (percentual?'<small>'+percentual+'</small>':'')+'</span></div></li>';
  }).join('')+'</ol>':
  '<p class="muted">Nenhum alimento programado nesta dieta.</p>';
 $('modalRankingDieta').showModal();
}
function abrirMacroRefeicao(refeicao,tipo){
 const itens=(tipo==='dieta'?state.dieta:state.diario).filter(i=>i.refeicao===refeicao);
 if(!itens.length)return;
 exibirModalMacros(itens,(MEALS[refeicao]||refeicao)+' · '+(tipo==='dieta'?'Dieta programada':'Consumo real'));
}
function abrirMacroAlimento(id){
 const item=state.dieta.find(i=>String(i.id)===String(id));
 if(!item)return;
 exibirModalMacros([item],item.alimento_nome+' · '+fmt(item.quantidade_g,1)+' g · Dieta programada');
}
function exibirModalMacros(itens,titulo){
 const a=aggregate(itens),p=a.total.proteinas_g*4,c=a.total.carboidratos_g*4,g=a.total.gorduras_g*9;
 const partes=[['Proteínas',p,a.total.proteinas_g,'#2782ac'],['Carboidratos',c,a.total.carboidratos_g,'#efaa4b'],['Gorduras',g,a.total.gorduras_g,'#65ad88']];
 const total=p+c+g;let pos=0;
 const cor=partes.map(x=>{const inicio=total?pos/total*100:0;pos+=x[1];return x[3]+' '+inicio+'% '+(total?pos/total*100:0)+'%';}).join(',');
 $('tituloMacros').textContent=titulo;
 const valor=(chave,unidade,casas=1)=>a.miss[chave]===itens.length?'Sem dado':fmt(a.total[chave],casas)+' '+unidade+(a.miss[chave]?'*':'');
 $('conteudoMacros').innerHTML='<p>Energia: '+valor('kcal','kcal',0)+' · Fibras: '+valor('fibras_g','g')+'</p>'+
 (total>0?'<div class="avn-meal-ring" role="img" aria-label="Distribuição energética dos macros" style="background:conic-gradient('+cor+')"></div>':'<p class="muted">Sem dados suficientes para gerar o gráfico.</p>')+
 '<div class="avn-meal-legend">'+partes.map(x=>'<div><i style="background:'+x[3]+'"></i>'+x[0]+': '+(a.miss[{Proteínas:'proteinas_g',Carboidratos:'carboidratos_g',Gorduras:'gorduras_g'}[x[0]]]===itens.length?'Sem dado':fmt(x[2])+' g')+' ('+(total?fmt(x[1]*100/total,1):0)+'%)</div>').join('')+'</div>'+
 (['kcal','proteinas_g','carboidratos_g','gorduras_g','fibras_g'].some(k=>a.miss[k])?'<p class="muted">Alguns alimentos não têm todos os valores nutricionais informados.</p>':'');
 $('modalMacros').showModal();
}
function ativarAbaDiario(aba,focar=false){
 const tabs=[...document.querySelectorAll('#modalAdicionarDiario [role="tab"]')];
 for(const tab of tabs){
  const ativa=tab.dataset.abaDiario===aba;
  tab.setAttribute('aria-selected',String(ativa));
  tab.tabIndex=ativa?0:-1;
  $(tab.getAttribute('aria-controls')).hidden=!ativa;
  if(ativa&&focar)tab.focus();
 }
}
function events(){
 if(has('fecharMacros')){
  $('fecharMacros').onclick=()=>$('modalMacros').close();
  document.addEventListener('click',e=>{
   const ranking=e.target.closest('[data-ranking-dieta]');
   if(PAGE==='dieta'&&ranking){e.preventDefault();abrirRankingDieta(ranking.dataset.rankingDieta);return;}
   const alimento=e.target.closest('[data-macro-food]');
   if(PAGE==='dieta'&&alimento){e.preventDefault();abrirMacroAlimento(alimento.dataset.macroFood);return;}
   const refeicao=e.target.closest('[data-macro-meal]');
   if(refeicao){e.preventDefault();abrirMacroRefeicao(refeicao.dataset.macroMeal,refeicao.dataset.macroSource);}
  });
}

 $('usuario').onchange=async()=>{if(PAGE==='dieta'){invalidarImportacaoDieta(true);dietaCatalogoImportacao=[];}state.usuarioId=v('usuario');metaPendente=null;historicoMetas=[];if(has('modalCalculadoraGkg')&&$('modalCalculadoraGkg').open)$('modalCalculadoraGkg').close();if(has('modalHistoricoMetas')&&$('modalHistoricoMetas').open)$('modalHistoricoMetas').close();localStorage.setItem('avn_nutricao_usuario',state.usuarioId);try{await reload();}catch(e){show(e.message,true);}};
 if(PAGE==='diario'){
 $('abrirModalDiario').onclick=()=>$('modalAdicionarDiario').showModal();
 $('fecharModalDiario').onclick=()=>$('modalAdicionarDiario').close();
 $('modalAdicionarDiario').addEventListener('close',()=>ativarAbaDiario('avulso'));
 const abasDiario=[...document.querySelectorAll('#modalAdicionarDiario [role="tab"]')];
 abasDiario.forEach((tab,indice)=>{
  tab.addEventListener('click',()=>ativarAbaDiario(tab.dataset.abaDiario));
  tab.addEventListener('keydown',e=>{
   let proxima=null;
   if(e.key==='ArrowRight')proxima=(indice+1)%abasDiario.length;
   if(e.key==='ArrowLeft')proxima=(indice-1+abasDiario.length)%abasDiario.length;
   if(e.key==='Home')proxima=0;
   if(e.key==='End')proxima=abasDiario.length-1;
   if(proxima===null)return;
   e.preventDefault();
   ativarAbaDiario(abasDiario[proxima].dataset.abaDiario,true);
  });
 });
 $('fecharEdicaoConsumo').onclick=()=>$('modalEditarConsumo').close();
 $('listaDiario').addEventListener('click',e=>{
  const botao=e.target.closest('[data-edit-consumo]');if(!botao)return;
  const item=state.diario.find(i=>String(i.id)===botao.dataset.editConsumo);
  if(!item)return;editandoConsumoId=item.id;
  $('nomeEdicaoConsumo').textContent=item.alimento_nome;
  $('gramasEdicaoConsumo').value=item.quantidade_g;
  const foods=state.alimentos.map(f=>'<option value="'+esc(f.id)+'">'+esc(f.nome)+'</option>').join('');
  $('alimentoEdicaoConsumo').innerHTML=(!state.alimentos.some(f=>String(f.id)===String(item.alimento_id))?
   '<option value="'+esc(item.alimento_id)+'">'+esc(item.alimento_nome)+' (atual)</option>':'')+foods;
  $('alimentoEdicaoConsumo').value=item.alimento_id;
  $('refeicaoEdicaoConsumo').innerHTML=Object.entries(MEALS).map(([id,nome])=>'<option value="'+esc(id)+'">'+esc(nome)+'</option>').join('');
  $('refeicaoEdicaoConsumo').value=item.refeicao;
  $('modalEditarConsumo').showModal();
 });
 $('formEditarConsumo').onsubmit=async e=>{e.preventDefault();try{
  userGuard();const peso=Number(v('gramasEdicaoConsumo'));
  if(!editandoConsumoId||!Number.isFinite(peso)||peso<=0||peso>10000)throw Error('Peso inválido.');
  const anterior=state.diario.find(i=>String(i.id)===String(editandoConsumoId));
  const alimento_id=v('alimentoEdicaoConsumo'),refeicao=v('refeicaoEdicaoConsumo');
  const dados={quantidade_g:peso,refeicao};
  if(String(anterior?.alimento_id)!==String(alimento_id))dados.alimento_id=alimento_id;
  await send('/diario/'+state.usuarioId+'/'+editandoConsumoId,'PUT',dados);
  $('modalEditarConsumo').close();await loadDaily();show('Pesagem do consumo atualizada.');
 }catch(err){show(err.message,true);}};

 $('dataDiario').onchange=async()=>{state.data=v('dataDiario');$('refeicaoPlanejada').value='';try{await Promise.all([loadDaily(),loadDiet()]);}catch(e){show(e.message,true);}};
 $('formDiario').onsubmit=async e=>{e.preventDefault();try{userGuard();await send('/diario/'+state.usuarioId,'POST',{data:state.data,alimento_id:v('diarioAlimento'),refeicao:v('diarioRefeicao'),quantidade_g:Number(v('diarioGramas'))});await loadDaily();$('modalAdicionarDiario').close();show('Alimento registrado no diário.');}catch(err){show(err.message,true);}};
 $('refeicaoPlanejada').onchange=renderPlannedMeal;
 $('registrarRefeicao').onclick=registrarRefeicaoPlanejada;
 }
 if(PAGE==='dieta'){
 $('fecharRankingDieta').onclick=()=>$('modalRankingDieta').close();
 $('abrirModalDieta').onclick=()=>$('modalAdicionarDieta').showModal();
  $('listaDieta').addEventListener('click',e=>{
   const botao=e.target.closest('[data-adicionar-refeicao]');
   if(botao){e.preventDefault();abrirModalAdicionarNaRefeicao(botao.dataset.adicionarRefeicao);}
  });
  $('fecharModalAdicionarRefeicaoDieta').onclick=()=>$('modalAdicionarRefeicaoDieta').close();
  $('modalAdicionarRefeicaoDieta').addEventListener('close',devolverFormularioDieta);
  $('abrirAnaliseDieta').onclick=abrirAnaliseNutricionalDieta;
  $('imprimirDieta').onclick=imprimirRelatorioDieta;
  $('fecharAnaliseDieta').onclick=()=>$('modalAnaliseDieta').close();
  $('abaMacrosDieta').onclick=()=>tabAnaliseDieta('macros');
  $('abaMicrosDieta').onclick=()=>tabAnaliseDieta('micros');
  ['abaMacrosDieta','abaMicrosDieta'].forEach(id=>$(id).addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const tab=e.key==='ArrowLeft'||e.key==='Home'?'macros':'micros';tabAnaliseDieta(tab);$(tab==='macros'?'abaMacrosDieta':'abaMicrosDieta').focus();}));
 $('fecharModalDieta').onclick=()=>$('modalAdicionarDieta').close();
 $('dietaRefeicao').onchange=()=>{invalidarImportacaoDieta();destinoImportacaoDieta();};
 $('dietaTextoIngredientes').oninput=()=>invalidarImportacaoDieta();
 $('dietaInterpretarIngredientes').onclick=interpretarIngredientesDieta;
 $('dietaAplicarImportacao').onclick=aplicarIngredientesDieta;
 destinoImportacaoDieta();
 $('formDieta').onsubmit=async e=>{e.preventDefault();try{userGuard();await send('/dieta/'+state.usuarioId+'/itens','POST',{alimento_id:v('dietaAlimento'),refeicao:v('dietaRefeicao'),quantidade_g:Number(v('dietaGramas'))});await loadDiet();const dialogo=$('modalAdicionarRefeicaoDieta').open?$('modalAdicionarRefeicaoDieta'):$('modalAdicionarDieta');dialogo.close();show('Item adicionado à programação.');}catch(err){show(err.message,true);}};
 }
 if(PAGE==='alimentos'){
 $('abrirModalAlimento').onclick=()=>{fillFood(null);$('modalAlimento').showModal();};
 $('fecharModalAlimento').onclick=()=>$('modalAlimento').close();
 $('buscaAlimento').oninput=renderFoodList;
 $('limparAlimento').onclick=()=>fillFood(null);
 configurarIA();
 $('buscaMicroAlimento').oninput=()=>filtrarNutrientes('camposMicros','buscaMicroAlimento');

 $('formAlimento').onsubmit=async e=>{e.preventDefault();try{
 userGuard();const id=v('alimentoId');const b={usuarioId:state.usuarioId,nome:v('alimentoNome'),marca:v('alimentoMarca'),preparo:v('alimentoPreparo'),porcao_nome:v('porcaoNome'),porcao_gramas:numberOrNull('porcaoGramas'),micronutrientes_100g:getMicros('micro')};
 for(const [key] of MACROS)b[key+'_100g']=numberOrNull('alim_'+key);
 if(!id&&state.origemImportacao)Object.assign(b,state.origemImportacao);
 await send('/alimentos'+(id?'/'+id:''),id?'PUT':'POST',b);fillFood(null);$('modalAlimento').close();await loadFoods();show('Alimento salvo.');
 }catch(err){show(err.message,true);}};
 }
 if(PAGE==='metas'){
 $('abaCaloriasMetas').onclick=()=>selecionarAbaMetas('calorias');
 $('abaMicrosMetas').onclick=()=>selecionarAbaMetas('micros');
 for(const tab of [$('abaCaloriasMetas'),$('abaMicrosMetas')])tab.addEventListener('keydown',e=>{
  if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;
  e.preventDefault();selecionarAbaMetas(e.key==='ArrowRight'||e.key==='End'?'micros':'calorias',true);
 });
 $('abrirCalculadoraGkg').onclick=()=>abrirCalculadoraGkg().catch(e=>show(e.message,true));
 $('fecharCalculadoraGkg').onclick=()=>$('modalCalculadoraGkg').close();
 for(const id of ['pesoCalculadoraGkg','gkgProteinas','gkgCarboidratos','gkgGorduras'])
  $(id).addEventListener('input',calcularPreviaGkg);
 $('aplicarCalculadoraGkg').onclick=aplicarCalculadoraGkg;
 $('abrirHistoricoMetas').onclick=()=>abrirHistoricoMetas().catch(e=>show(e.message,true));
 $('fecharHistoricoMetas').onclick=()=>$('modalHistoricoMetas').close();
 $('listaHistoricoMetas').addEventListener('click',e=>{
  const botao=e.target.closest('[data-restaurar-meta]');if(botao)restaurarMeta(botao.dataset.restaurarMeta);
 });
 $('camposMetas').addEventListener('input',()=>{metaPendente=null;atualizarResumoEnergiaMetas();});
 $('abrirSugestaoMetas').onclick=()=>{try{userGuard();$('resultadoSugestaoMetas').textContent='';$('aplicarSugestaoMetas').hidden=true;$('modalSugestaoMetas').showModal();}catch(e){show(e.message,true);}};
 $('fecharSugestaoMetas').onclick=()=>$('modalSugestaoMetas').close();
 $('gerarSugestaoMetas').onclick=async()=>{
  const botao=$('gerarSugestaoMetas');botao.disabled=true;$('resultadoSugestaoMetas').textContent='Consultando suas medições e o assistente de IA…';
  $('aplicarSugestaoMetas').hidden=true;state.sugestaoMetas=null;
  try{
   userGuard();const resultado=await send('/metas/'+state.usuarioId+'/sugerir-ia','POST',{objetivo:v('objetivoMetasIA'),atividade:v('atividadeMetasIA')});
   state.sugestaoMetas=resultado.metas;const m=resultado.metas;
   $('resultadoSugestaoMetas').innerHTML='<div class="avn-meal-legend">'+MACROS.map(([key,nome,unidade])=>'<div><strong>'+esc(nome)+'</strong>: '+fmt(m[key],1)+' '+esc(unidade)+'</div>').join('')+'</div>'+
    '<p>'+esc(resultado.explicacao)+'</p><p class="muted">'+esc(resultado.aviso)+'</p>';
   $('aplicarSugestaoMetas').hidden=false;
  }catch(error){$('resultadoSugestaoMetas').textContent=error.message;}
  finally{botao.disabled=false;}
 };
 $('aplicarSugestaoMetas').onclick=()=>{
  if(!state.sugestaoMetas)return;for(const [key] of MACROS)$('meta_'+key).value=state.sugestaoMetas[key];
  metaPendente={origem:'ia'};atualizarResumoEnergiaMetas();
  $('modalSugestaoMetas').close();show('Sugestão preenchida. Confira e clique em Salvar metas para confirmar.');
 };
 $('buscaMicroMetas').oninput=()=>filtrarNutrientes('camposMicroMetas','buscaMicroMetas');
 $('formMetas').onsubmit=async e=>{e.preventDefault();try{userGuard();const b={micros:getMicros('metamicro'),...(metaPendente||{origem:'manual'})};for(const [key] of MACROS)b[key]=numberOrNull('meta_'+key);await send('/metas/'+state.usuarioId,'PUT',b);metaPendente=null;await loadGoals();renderDaily();show('Metas salvas e registradas no histórico.');}catch(err){show(err.message,true);}}; }
}
window.AVNNutricaoInterno={state,MEALS,esc,fmt,localDate,show,api,send,loadDiet,loadDaily,renderDiet,renderDaily,userGuard};
async function init(){try{await loadNutrients();inputs();state.data=localDate();if(has('dataDiario'))$('dataDiario').value=state.data;state.dias=diaSemana(state.data);events();await startUsers();}catch(e){show(e.message,true);}}
init();
})();
