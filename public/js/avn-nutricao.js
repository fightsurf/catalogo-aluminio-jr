/* AVN Nutrição v1 — diário distinto da dieta planejada; dados por 100g. */
(()=>{'use strict';
const $=id=>document.getElementById(id);
const API='/avn/sistema/api/nutricao';
const MEALS={cafe:'Café da manhã',lanche_manha:'Lanche da manhã',almoco:'Almoço',lanche_tarde:'Lanche da tarde',jantar:'Jantar',ceia:'Ceia',outros:'Outros'};
const DAYS=['Segunda','Terça','Quarta','Quinta','Sexta','Sábado','Domingo'];
const MACROS=[['kcal','Energia','kcal'],['proteinas_g','Proteínas','g'],['carboidratos_g','Carboidratos','g'],['gorduras_g','Gorduras','g'],['fibras_g','Fibras','g']];
let MICRO=[]; // definição dinâmica via tabela avn_nutrientes
const state={usuarioId:'',alimentos:[],diario:[],dieta:[],metas:{},data:'',tab:'diario',dias:0,loading:false};
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
 const q=$(searchId).value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
 const fields=[...$(container).querySelectorAll('label[data-search]')];
 fields.forEach(el=>el.hidden=!!q&&!el.dataset.search.includes(q));
 for(const group of $(container).querySelectorAll('h4[data-categoria]')){
  group.hidden=!fields.some(f=>f.dataset.categoria===group.dataset.categoria&&!f.hidden);
 }
}
function inputs(){
 $('camposMacros').innerHTML=MACROS.map(([k,l,u])=>nInput(k,l,u,'','alim')).join('');
 $('camposMetas').innerHTML=MACROS.map(([k,l,u])=>nInput(k,l,u,'','meta')).join('');
 inputNutrientes('micro','camposMicros');inputNutrientes('metamicro','camposMicroMetas');
 for(const id of ['diarioRefeicao','dietaRefeicao'])$(id).innerHTML=Object.entries(MEALS).map(([k,l])=>`<option value="${k}">${l}</option>`).join('');
 $('diarioRefeicao').value='almoco';$('dietaRefeicao').value='almoco';
}
async function loadNutrients(preserve=false){
 const r=await api('/nutrientes');
 MICRO=r.micros.map(x=>[x.codigo,x.nome,x.unidade,x.categoria]);
 if(preserve){inputNutrientes('micro','camposMicros',true);inputNutrientes('metamicro','camposMicroMetas',true);
  filtrarNutrientes('camposMicros','buscaMicroAlimento');filtrarNutrientes('camposMicroMetas','buscaMicroMetas');}
}
function selectFoods(){const opt=state.alimentos.map(f=>`<option value="${f.id}">${esc(f.nome)}${f.preparo?' · '+esc(f.preparo):''}${f.marca?' · '+esc(f.marca):''}</option>`).join('');
 for(const id of ['diarioAlimento','dietaAlimento']){const e=$(id),prev=e.value;e.innerHTML='<option value="">Selecione um alimento</option>'+opt;if(state.alimentos.some(f=>String(f.id)===prev))e.value=prev;}
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
function renderDaily(){
 const a=aggregate(state.diario);a.total.count=a.count;
 $('resumoDiario').innerHTML=MACROS.map(([key,label,unit])=>stat(a.total,a.miss,key,label,unit,state.metas[key])).join('');
 $('listaDiario').innerHTML=state.diario.length?state.diario.map(i=>{
 const energy=i.composicao_100g?.kcal;
 const kcal=energy==null?'Energia desconhecida':fmt(Number(energy)*Number(i.quantidade_g)/100,0)+' kcal';
 return `<div class="list-row"><div><span class="name">${esc(i.alimento_nome)}</span><small>${esc(MEALS[i.refeicao]||i.refeicao)} · ${fmt(i.quantidade_g)} g · ${kcal}${i.plano_item_id?' · da dieta':''}</small></div><button type="button" class="delete" data-consumo="${i.id}" aria-label="Remover registro">Excluir</button></div>`;
 }).join(''):'<p class="muted">Nenhum alimento registrado nesta data.</p>';
 $('listaDiario').querySelectorAll('[data-consumo]').forEach(btn=>btn.onclick=async()=>{if(!confirm('Excluir este alimento do diário?'))return;try{await send(`/diario/${state.usuarioId}/${btn.dataset.consumo}`,'DELETE');await loadDaily();show('Registro excluído.');}catch(e){show(e.message,true);}});
 $('microDiario').innerHTML=MICRO.filter(([key])=> $('mostrarTodosMicros').checked || state.metas.micros?.[key]!=null || state.diario.some(r=>r.composicao_100g?.micros?.[key]!=null)).map(([key,label,unit])=>{
 const has=state.diario.length&&a.miss[key]===state.diario.length;
 const part=a.miss[key]>0&&!has;
 const val=has?'Sem dado':fmt(a.total[key],2)+' '+unit+(part?'*':'');
 const target=state.metas.micros?.[key];return `<div class="micro-item"><small>${label}</small><strong>${val}</strong><small>${target!=null?'Meta: '+fmt(target)+' '+unit:'Sem meta'}${a.miss[key]?' · incompleto':''}</small></div>`;
 }).join('') || '<p class="muted">Não há informações de micronutrientes cadastradas para os itens consumidos.</p>';
}
function renderDiet(){
 const rows=state.dieta.filter(r=>Number(r.dia_semana)===state.dias);
 const a=aggregate(rows);$('listaDieta').innerHTML=rows.length?rows.map(i=>{
 const kcal=i.kcal_100g==null?'Energia desconhecida':fmt(Number(i.kcal_100g)*Number(i.quantidade_g)/100,0)+' kcal';
 return `<div class="list-row"><div><span class="name">${esc(i.alimento_nome)}</span><small>${esc(MEALS[i.refeicao]||i.refeicao)} · ${fmt(i.quantidade_g)} g · ${kcal}</small></div><button type="button" class="delete" data-plano="${i.id}">Excluir</button></div>`;
 }).join(''):'<p class="muted">Nenhuma refeição programada para '+DAYS[state.dias]+'.</p>';
 $('resumoDieta').textContent=rows.length?`Total planejado: ${fmt(a.total.kcal,0)} kcal${a.miss.kcal?' (incompleto)':''} · ${fmt(a.total.proteinas_g)} g proteína · ${fmt(a.total.carboidratos_g)} g carboidratos · ${fmt(a.total.gorduras_g)} g gorduras`:'';
 $('listaDieta').querySelectorAll('[data-plano]').forEach(btn=>btn.onclick=async()=>{if(!confirm('Excluir item da dieta programada?'))return;try{await send(`/dieta/${state.usuarioId}/itens/${btn.dataset.plano}`,'DELETE');await loadDiet();show('Item removido da programação.');}catch(e){show(e.message,true);}});
}
function renderFoodList(){
 const q=($('buscaAlimento').value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 const list=state.alimentos.filter(f=>(f.nome+' '+(f.preparo||'')+' '+(f.marca||'')).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().includes(q));
 $('listaAlimentos').innerHTML=list.length?list.map(f=>`<div class="list-row"><div><span class="name">${esc(f.nome)}</span><small>${esc([f.preparo,f.marca].filter(Boolean).join(' · '))} ${f.kcal_100g==null?'· Energia sem dado':'· '+fmt(f.kcal_100g,1)+' kcal/100 g'}</small></div><button type="button" class="secondary" data-edit="${f.id}">Editar</button></div>`).join(''):'<p class="muted">Nenhum alimento encontrado. Cadastre o primeiro alimento no formulário.</p>';
 $('listaAlimentos').querySelectorAll('[data-edit]').forEach(btn=>btn.onclick=()=>fillFood(state.alimentos.find(a=>String(a.id)===btn.dataset.edit)));
}
function fillFood(f){
 $('formAlimento').reset();$('tituloAlimento').textContent=f?'Editar alimento':'Novo alimento';$('alimentoId').value=f?.id||'';
 $('alimentoNome').value=f?.nome||'';$('alimentoMarca').value=f?.marca||'';$('alimentoPreparo').value=f?.preparo||'';
 $('porcaoNome').value=f?.porcao_nome||'';$('porcaoGramas').value=f?.porcao_gramas||'';
 for(const [key] of MACROS)$('alim_'+key).value=f?.[key+'_100g']??'';
 for(const [key] of MICRO)$('micro_'+key).value=f?.micronutrientes_100g?.[key]??'';
 if(f)$('formAlimento').scrollIntoView({behavior:'smooth',block:'start'});
}
function numberOrNull(id){const x=v(id);if(x==='')return null;const n=Number(x);if(!Number.isFinite(n)||n<0)throw Error('Valor inválido: '+id);return n;}
function getMicros(prefix){const data={};for(const [key] of MICRO){const value=numberOrNull(prefix+'_'+key);if(value!==null)data[key]=value;}return data;}
function fillGoals(){for(const [key] of MACROS)$('meta_'+key).value=state.metas[key]??'';for(const [key] of MICRO)$('metamicro_'+key).value=state.metas.micros?.[key]??'';}
async function loadFoods(){state.alimentos=await api('/alimentos?usuarioId='+state.usuarioId);selectFoods();renderFoodList();}
async function loadGoals(){state.metas=await api('/metas/'+state.usuarioId);fillGoals();}
async function loadDiet(){const r=await api('/dieta/'+state.usuarioId);state.dieta=r.itens;renderDiet();}
async function loadDaily(){const r=await api('/diario/'+state.usuarioId+'?data='+state.data);state.diario=r.itens;renderDaily();}
async function reload(){if(!state.usuarioId){state.alimentos=[];state.diario=[];state.dieta=[];state.metas={};selectFoods();renderFoodList();renderDiet();renderDaily();fillGoals();return;}await Promise.all([loadFoods(),loadGoals(),loadDiet(),loadDaily()]);renderDaily();}
function tab(name){state.tab=name;document.querySelectorAll('.avn-panel').forEach(el=>el.hidden=el.id!==name);document.querySelectorAll('[data-tab]').forEach(el=>el.classList.toggle('active',el.dataset.tab===name));}
async function startUsers(){
 const r=await fetch('/api/avn/usuarios',{credentials:'same-origin'});if(!r.ok)throw Error('Não foi possível consultar usuários cadastrados.');const users=await r.json();
 const remembered=localStorage.getItem('avn_nutricao_usuario')||localStorage.getItem('avn_treinos_usuario')||'';
 state.usuarioId=users.some(u=>String(u.id)===remembered)?remembered:String(users[0]?.id||'');
 $('usuario').innerHTML='<option value="">Selecione usuário</option>'+users.map(u=>`<option value="${u.id}">${esc(u.nome)}</option>`).join('');$('usuario').value=state.usuarioId;
 if(!state.usuarioId){show('Cadastre um usuário na Central AVN antes de registrar alimentos.',true);return;}
 localStorage.setItem('avn_nutricao_usuario',state.usuarioId);await reload();
}
function events(){
 document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>tab(b.dataset.tab));
 $('dataDiario').onchange=async()=>{state.data=v('dataDiario');try{await loadDaily();}catch(e){show(e.message,true);}};
 $('diaDieta').onchange=()=>{state.dias=Number(v('diaDieta'));renderDiet();};
 $('usuario').onchange=async()=>{state.usuarioId=v('usuario');localStorage.setItem('avn_nutricao_usuario',state.usuarioId);try{await reload();}catch(e){show(e.message,true);}};
 $('buscaAlimento').oninput=renderFoodList;
 $('limparAlimento').onclick=()=>fillFood(null);
 $('buscaMicroAlimento').oninput=()=>filtrarNutrientes('camposMicros','buscaMicroAlimento');
 $('buscaMicroMetas').oninput=()=>filtrarNutrientes('camposMicroMetas','buscaMicroMetas');
 $('mostrarTodosMicros').onchange=renderDaily;
 $('formNutriente').onsubmit=async e=>{e.preventDefault();try{
  userGuard();const data={nome:v('nutrienteNome'),unidade:v('nutrienteUnidade'),categoria:v('nutrienteCategoria')};
  const response=await send('/nutrientes','POST',data);
  await loadNutrients(true);$('formNutriente').reset();
  $('buscaMicroAlimento').value='';filtrarNutrientes('camposMicros','buscaMicroAlimento');
  $('buscaMicroMetas').value='';filtrarNutrientes('camposMicroMetas','buscaMicroMetas');
  renderDaily();show(response.nome+' cadastrado. Agora pode preencher a quantidade por 100 g.');
 }catch(err){show(err.message,true);}};

 $('formAlimento').onsubmit=async e=>{e.preventDefault();try{
 userGuard();const id=v('alimentoId');const b={usuarioId:state.usuarioId,nome:v('alimentoNome'),marca:v('alimentoMarca'),preparo:v('alimentoPreparo'),porcao_nome:v('porcaoNome'),porcao_gramas:numberOrNull('porcaoGramas'),micronutrientes_100g:getMicros('micro')};
 for(const [key] of MACROS)b[key+'_100g']=numberOrNull('alim_'+key);
 await send('/alimentos'+(id?'/'+id:''),id?'PUT':'POST',b);fillFood(null);await loadFoods();await loadDiet();show('Alimento salvo.');
 }catch(err){show(err.message,true);}};
 $('formDiario').onsubmit=async e=>{e.preventDefault();try{userGuard();await send('/diario/'+state.usuarioId,'POST',{data:state.data,alimento_id:v('diarioAlimento'),refeicao:v('diarioRefeicao'),quantidade_g:Number(v('diarioGramas'))});await loadDaily();show('Alimento registrado no diário.');}catch(err){show(err.message,true);}};
 $('formDieta').onsubmit=async e=>{e.preventDefault();try{userGuard();await send('/dieta/'+state.usuarioId+'/itens','POST',{dia_semana:state.dias,alimento_id:v('dietaAlimento'),refeicao:v('dietaRefeicao'),quantidade_g:Number(v('dietaGramas'))});await loadDiet();show('Item adicionado à programação.');}catch(err){show(err.message,true);}};
 $('copiarDieta').onclick=async()=>{try{
 userGuard();const d=DAYS[diaSemana(state.data)];if(!state.dieta.some(i=>Number(i.dia_semana)===diaSemana(state.data))){show('Não há dieta programada para '+d+'.',true);return;}
 if(!confirm(`Você REALMENTE consumiu TODOS os alimentos planejados para ${d}, ${state.data}? Só confirme se comeu.`))return;
 const r=await send('/diario/'+state.usuarioId+'/copiar-dieta','POST',{data:state.data});await loadDaily();show(`${r.inseridos} alimento(s) registrados. Itens já copiados não foram duplicados.`);
 }catch(err){show(err.message,true);}};
 $('formMetas').onsubmit=async e=>{e.preventDefault();try{userGuard();const b={micros:getMicros('metamicro')};for(const [key] of MACROS)b[key]=numberOrNull('meta_'+key);await send('/metas/'+state.usuarioId,'PUT',b);await loadGoals();renderDaily();show('Metas atualizadas.');}catch(err){show(err.message,true);}};
}
async function init(){try{await loadNutrients();inputs();state.data=localDate();$('dataDiario').value=state.data;state.dias=diaSemana(state.data);$('diaDieta').value=String(state.dias);events();await startUsers();}catch(e){show(e.message,true);}}
init();
})();
