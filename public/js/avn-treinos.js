/* AVN Treinamento — Render. Sem dependência do app Android. */
(() => {
'use strict';
const $ = id => document.getElementById(id);
const page=document.body.dataset.page;
const API='/avn/sistema/api/treinos';
const NOMES=['Segunda','Terça','Quarta','Quinta','Sexta','Sábado','Domingo'];
const state={usuarios:[],grupos:[],exercicios:[],nomes:new Map(),planos:[],usuarioId:'',filtro:'',grupo:'',dia:0,plano:null,treino:null,treinoDia:0};
const esc = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const isId = v => /^\d+$/.test(String(v||''));
const isAnimated = url => typeof url==='string' && /^\/avn\/sistema\/midias\/[a-z0-9-]+\/frame-1\.svg$/.test(url);
let frame=1;
function animateVisible(){if(document.hidden||window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;frame=frame===3?1:frame+1;document.querySelectorAll('img.avn-animated').forEach(img=>{const rect=img.getBoundingClientRect();if(rect.bottom<0||rect.top>innerHeight)return;const base=img.dataset.base;if(base)img.src=base.replace('/frame-1.svg','/frame-'+frame+'.svg');});}
setInterval(animateVisible,950);
let toastTimer;
function toast(message,error=false){const t=$('toast');t.textContent=message;t.className='toast'+(error?' error':'');t.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.hidden=true,5000);}
async function fetchJSON(endpoint,options={}){
  const resp=await fetch(API+endpoint,{credentials:'same-origin',headers:{'Content-Type':'application/json'},...options});
  if(resp.redirected && resp.url.includes('/login'))throw Error('Sessão expirada: faça login novamente.');
  const data=await resp.json().catch(()=>{throw Error('Servidor não retornou JSON. Verifique sua sessão.');});
  if(!resp.ok)throw Error(data.erro||'Operação não concluída.');return data;
}
async function users(){
  const resp=await fetch('/api/avn/usuarios',{credentials:'same-origin'});
  if(!resp.ok)throw Error('Não foi possível carregar usuários.');state.usuarios=await resp.json();
  const stored=localStorage.getItem('avn_treinos_usuario')||'';
  state.usuarioId=state.usuarios.some(x=>String(x.id)===stored)?stored:String(state.usuarios[0]?.id||'');
  const select=$('usuario');select.innerHTML='<option value="">Selecione usuário</option>'+state.usuarios.map(u=>`<option value="${u.id}">${esc(u.nome)}</option>`).join('');select.value=state.usuarioId;
  select.addEventListener('change',async()=>{state.usuarioId=select.value;localStorage.setItem('avn_treinos_usuario',state.usuarioId);state.plano=null;state.treino=null;if(page==='montador'&&location.search)history.replaceState(null,'',location.pathname);try{await show();}catch(e){toast(e.message,true)}});
}
async function base(){state.grupos=await fetchJSON('/grupos');await buscarExercicios();}
async function buscarExercicios(){state.exercicios=await fetchJSON('/exercicios?busca='+encodeURIComponent(state.filtro)+'&grupo='+encodeURIComponent(state.grupo));state.exercicios.forEach(e=>state.nomes.set(Number(e.id),e.nome));}
function media(ex,small=false){
 if(!ex?.midia_url)return `<div class="thumb" title="Sem mídia cadastrada">Sem mídia</div>`;
 const url=esc(ex.midia_url),name=esc(ex.nome);
 if(ex.midia_tipo==='video')return `<video class="thumb" src="${url}" autoplay muted loop playsinline preload="metadata" title="Demonstração: ${name}"></video>`;
 const anim=isAnimated(ex.midia_url);
 const img=`<img class="thumb ${anim?'avn-animated':''}" src="${url}" data-base="${url}" alt="Demonstração ilustrada: ${name}" loading="lazy" decoding="async" onerror="this.onerror=null;this.classList.add('media-missing');this.alt='Imagem indisponível';">`;
 return anim?`<span class="thumb-frame" title="Demonstração animada: ${name}">${img}</span>`:img;
}
function selectGrupos(){return `<option value="">Todos os grupos</option>`+state.grupos.map(g=>`<option value="${esc(g.slug)}" ${state.grupo===g.slug?'selected':''}>${esc(g.nome)}</option>`).join('');}
function usuarioGuard(){if(state.usuarioId)return false;$('conteudo').innerHTML='<div class="empty">Cadastre e selecione um usuário na Central AVN para começar.</div>';return true;}
function campo(nome,id,value='',type='text',extra=''){return `<label class="label">${nome}<input id="${id}" type="${type}" value="${esc(value)}" ${extra}></label>`;}
function preview(ex){if(!ex?.midia_url)return '<div class="empty">Sem demonstração cadastrada. Use somente mídia com licença de uso.</div>';
 const url=esc(ex.midia_url);
 if(ex.midia_tipo==='video')return `<video class="media-preview" src="${url}" controls playsinline preload="metadata"></video>`;
 const anim=isAnimated(ex.midia_url);
 const img=`<img class="media-preview ${anim?'avn-animated':''}" data-base="${url}" src="${url}" alt="Demonstração ilustrada" loading="lazy" decoding="async">`;
 return anim?`<div class="media-preview-frame">${img}</div>`:img;
}
function htmlExercicios(){
 $('conteudo').innerHTML=`<div class="avn-exercicios-centered"><section class="card stack">
 <div class="avn-action-header"><h2>Consultar exercícios</h2><div class="row"><button type="button" class="btn small" id="syncCatalog">Atualizar catálogo local</button><button type="button" class="btn primary" id="novoExercicio">+ Cadastrar exercício</button></div></div>
 <div class="filters">${campo('Pesquisar (ignora acentos)','busca',state.filtro,'search','placeholder="Ex.: rosca scott"')}<label class="label">Grupo muscular<select id="grupo">${selectGrupos()}</select></label></div>
 <span class="hint" id="quantidade"></span><div id="lista-exercicios" class="exercise-list"></div></section></div>
 <dialog id="modalExercicio" class="avn-dialog"><div class="avn-dialog-header"><h2 id="formTitle">Cadastrar exercício</h2><button type="button" class="btn ghost" id="fecharExercicio">Fechar ×</button></div>
 <form id="formExercicio" class="stack"><input type="hidden" id="exId"><label class="label">Nome<input id="exNome" maxlength="160" required></label>
 <div class="filters"><label class="label">Grupo<select id="exGrupo" required>${state.grupos.map(g=>`<option value="${g.id}">${esc(g.nome)}</option>`).join('')}</select></label>${campo('Equipamento','exEquip','Livre','text','maxlength="100"')}</div>
 <label class="label">Instruções<textarea id="exInstrucoes" maxlength="5000"></textarea></label>
 <div class="filters"><label class="label">Tipo de mídia<select id="exTipo"><option value="imagem">Imagem</option><option value="gif">GIF animado / SVG</option><option value="video">Vídeo MP4/WebM</option></select></label>${campo('URL HTTPS ou biblioteca AVN','exMidia','','text','placeholder="https://... ou /avn/sistema/midias/..."')}</div>
 <div id="exPreview" class="empty">Demonstração não cadastrada</div><div class="row"><button type="submit" class="btn primary">Salvar exercício</button><button type="button" class="btn danger hide" id="exDesativar">Desativar</button></div></form>
 <p class="hint">Ilustrações originais licenciadas pelo Workout Guide / Bryl Lim (CC BY-SA 4.0).</p></dialog>`;
 $('busca').oninput=debounce(async()=>{state.filtro=$('busca').value;await buscarExercicios();renderExerciciosLista();},250);
 $('grupo').onchange=async()=>{state.grupo=$('grupo').value;await buscarExercicios();renderExerciciosLista();};
 $('syncCatalog').onclick=async()=>{const b=$('syncCatalog');b.disabled=true;try{const r=await fetchJSON('/catalogo/sincronizar',{method:'POST'});toast(r.total+' exercícios processados.');state.grupos=await fetchJSON('/grupos');await buscarExercicios();htmlExercicios();}catch(e){toast('Falha ao atualizar: '+e.message,true);b.disabled=false;}};
 $('novoExercicio').onclick=()=>{fillEx(null);$('modalExercicio').showModal();};
 $('fecharExercicio').onclick=()=>$('modalExercicio').close();
 $('formExercicio').onsubmit=salvarExercicio;
 $('exDesativar').onclick=desativarExercicio;
 $('exTipo').onchange=atualizarPreview;
 $('exMidia').onchange=atualizarPreview;
 renderExerciciosLista();
}
function renderExerciciosLista(){
 const list=$('lista-exercicios');if(!list)return;
 $('quantidade').textContent=state.exercicios.length+' exercício(s) encontrado(s)';
 list.innerHTML=state.exercicios.length?state.exercicios.map(e=>`<div class="exercise">${media(e)}<div class="grow"><strong>${esc(e.nome)}</strong><small>${esc(e.grupo)} · ${esc(e.equipamento)}</small></div><button class="btn small" data-editar="${e.id}" aria-label="Editar ${esc(e.nome)}">Editar</button></div>`).join(''):'<div class="empty">Nenhum exercício encontrado.</div>';
 list.querySelectorAll('[data-editar]').forEach(b=>b.onclick=()=>{fillEx(state.exercicios.find(e=>String(e.id)===b.dataset.editar));$('modalExercicio').showModal();});
}
function fillEx(e){$('formTitle').textContent=e?'Editar exercício':'Cadastrar exercício';$('exId').value=e?.id||'';$('exNome').value=e?.nome||'';$('exGrupo').value=e?.grupo_id||state.grupos[0]?.id||'';$('exEquip').value=e?.equipamento||'Livre';$('exInstrucoes').value=e?.instrucoes||'';$('exTipo').value=e?.midia_tipo||'imagem';$('exMidia').value=e?.midia_url||'';$('exDesativar').classList.toggle('hide',!e);atualizarPreview();}
function atualizarPreview(){const url=$('exMidia').value.trim();$('exPreview').innerHTML=(/^https:\/\//i.test(url)||isAnimated(url))?preview({midia_url:url,midia_tipo:$('exTipo').value}):'<div class="empty">Informe a URL HTTPS de uma mídia licenciada.</div>';}
async function salvarExercicio(evt){evt.preventDefault();const id=$('exId').value;const body={nome:$('exNome').value,grupo_id:$('exGrupo').value,equipamento:$('exEquip').value,instrucoes:$('exInstrucoes').value,midia_tipo:$('exTipo').value,midia_url:$('exMidia').value};
 try{await fetchJSON('/exercicios'+(id?'/'+id:''),{method:id?'PUT':'POST',body:JSON.stringify(body)});toast('Exercício salvo.');await buscarExercicios();renderExerciciosLista();fillEx(null);$('modalExercicio')?.close();}catch(e){toast(e.message,true);}}
async function desativarExercicio(){const id=$('exId').value;if(!id||!confirm('Desativar este exercício? Ele permanecerá nos treinos históricos.'))return;
 try{await fetchJSON('/exercicios/'+id,{method:'DELETE'});await buscarExercicios();renderExerciciosLista();fillEx(null);$('modalExercicio')?.close();toast('Exercício desativado.');}catch(e){toast(e.message,true);}}
function novoPlano(){return {id:null,usuario_id:Number(state.usuarioId),nome:'Treino semanal',descricao:'',dias:NOMES.map((_,i)=>({dia_semana:i,exercicios:[]}))};}
function diaAtual(){return state.plano.dias.find(d=>Number(d.dia_semana)===state.dia);}
function getDia(exercicios,day){let d=exercicios.find(x=>Number(x.dia_semana)===day);if(!d){d={dia_semana:day,exercicios:[]};exercicios.push(d);}return d;}
function buscarNome(id){return state.nomes.get(Number(id)) || 'Exercício '+id;}
async function carregarPlano(id){const p=await fetchJSON('/planos/'+id);if(String(p.usuario_id)!==String(state.usuarioId))throw Error('Esse plano pertence a outro usuário.');state.plano=p;for(let i=0;i<7;i++)getDia(state.plano.dias,i);}
function listagemExerciciosMontador(){return state.exercicios.length?state.exercicios.map(e=>`<div class="exercise" draggable="true" data-exercicio="${e.id}">${media(e,true)}<div class="grow"><strong>${esc(e.nome)}</strong><small>${esc(e.grupo)} · ${esc(e.equipamento)}</small></div><button class="btn primary small" data-add="${e.id}" title="Selecionar exercício">Selecionar</button></div>`).join(''):'<div class="empty">Sem exercícios para este filtro.</div>';}
function htmlMontador(){
 $('conteudo').innerHTML=`<div class="avn-montador-centered"><section class="card stack">
 <div class="avn-action-header"><h2>Planejamento semanal</h2><div class="row"><button class="btn primary small" id="salvarPlano">Salvar treino</button><button class="btn small" id="limparDia">Limpar dia</button><button class="btn small" id="novoPlano">Novo plano</button><button class="btn primary small" id="abrirIA">✦ IA</button></div></div>
 <div class="row" style="align-items:end"><label class="label" style="flex:1;min-width:220px">Abrir programa salvo<select id="selecionarPlano"><option value="">Selecione um programa…</option></select></label><button type="button" class="btn danger" id="excluirPlano">Excluir programação</button></div>
 ${campo('Nome do plano','nomePlano',state.plano.nome,'text','maxlength="160" required')}
 <label class="label">Descrição<textarea id="descPlano" maxlength="4000" rows="4">${esc(state.plano.descricao)}</textarea></label>
 <div class="row between"><div class="day-tabs" id="dias"></div><button type="button" class="btn primary" id="abrirBiblioteca">+ Adicionar exercício</button></div>
 <p class="hint">Arraste ou use ↑ ↓ para reordenar exercícios.</p><div class="dropzone" id="itens"></div></section></div>
 <dialog id="avn-modal-biblioteca" class="avn-dialog"><div class="avn-dialog-header"><h2 id="bibliotecaTitulo">Biblioteca de exercícios</h2><button type="button" class="btn ghost" id="fecharBiblioteca">Fechar ×</button></div>
 <div class="filters">${campo('Buscar exercício','busca',state.filtro,'search','placeholder="Digite um nome"')}<label class="label">Grupo<select id="grupo">${selectGrupos()}</select></label></div><div class="exercise-list" id="listaMontador"></div></dialog>`;
 $('nomePlano').oninput=e=>state.plano.nome=e.target.value;
 $('descPlano').oninput=e=>state.plano.descricao=e.target.value;
 $('busca').oninput=debounce(async()=>{state.filtro=$('busca').value;try{await buscarExercicios();renderLibraryBuilder();}catch(e){toast(e.message,true);}},200);
 $('grupo').onchange=async()=>{state.grupo=$('grupo').value;try{await buscarExercicios();renderLibraryBuilder();}catch(e){toast(e.message,true);}};
 $('salvarPlano').onclick=salvarPlano;
 $('abrirIA').onclick=abrirModalIA;
 $('abrirBiblioteca').onclick=()=>abrirBiblioteca();
 $('fecharBiblioteca').onclick=()=>$('avn-modal-biblioteca').close();
 $('excluirPlano').disabled=!state.plano.id;
 $('excluirPlano').onclick=async()=>{
  if(!state.plano.id||!confirm('Excluir esta programação? Os treinos já registrados permanecerão no histórico.'))return;
  try{await fetchJSON('/planos/'+state.plano.id,{method:'DELETE',body:JSON.stringify({usuario_id:state.usuarioId})});state.plano=novoPlano();state.dia=0;htmlMontador();toast('Programação arquivada. Treinos realizados preservados.');}catch(e){toast(e.message,true);}
 };
 $('selecionarPlano').onchange=async e=>{if(!e.target.value)return;try{await carregarPlano(e.target.value);htmlMontador();toast('Programa carregado.');}catch(ex){toast(ex.message,true);}};
 atualizarSeletorPlanos();
 $('limparDia').onclick=()=>{if(confirm('Remover os exercícios deste dia?')){diaAtual().exercicios=[];renderDia();}};
 $('novoPlano').onclick=()=>{if(confirm('Começar novo plano sem salvar alterações pendentes?')){state.plano=novoPlano();state.dia=0;htmlMontador();}};
 renderLibraryBuilder();renderDia();
}
let bibliotecaSubstituirIndice=null;
function abrirBiblioteca(index=null){
 bibliotecaSubstituirIndice=index;
 $('bibliotecaTitulo').textContent=index===null?'Adicionar exercício':'Trocar exercício (preservar configurações)';
 $('avn-modal-biblioteca').showModal();
 renderLibraryBuilder();
 $('busca').focus();
}
function renderLibraryBuilder(){const list=$('listaMontador');if(!list)return;list.innerHTML=listagemExerciciosMontador();list.querySelectorAll('[data-add]').forEach(b=>b.onclick=async()=>{const id=Number(b.dataset.add);if(bibliotecaSubstituirIndice===null)addExercicio(id);else{const item=diaAtual().exercicios[bibliotecaSubstituirIndice];if(item){item.exercicio_id=id;renderDia();}}$('avn-modal-biblioteca').close();bibliotecaSubstituirIndice=null;state.filtro='';state.grupo='';try{await buscarExercicios();renderDia();}catch(e){toast(e.message,true);}});
 list.querySelectorAll('[data-exercicio]').forEach(el=>el.addEventListener('dragstart',e=>{e.dataTransfer.setData('text/avn-exercicio-id',el.dataset.exercicio);e.dataTransfer.effectAllowed='copy';}));}
function addExercicio(id,index){const a=diaAtual().exercicios;const i={exercicio_id:id,series:3,repeticoes:'10',carga_kg:null,descanso_seg:60,observacoes:''};if(index===undefined)a.push(i);else a.splice(index,0,i);renderDia();}
function mover(from,to){const a=diaAtual().exercicios;if(from===to||from<0||to<0||from>=a.length||to>=a.length)return;const [x]=a.splice(from,1);a.splice(to,0,x);renderDia();}
function renderDia(){
 const tabs=$('dias');if(!tabs)return;tabs.innerHTML=NOMES.map((n,i)=>`<button class="btn small ${state.dia===i?'selected':''}" data-dia="${i}" aria-pressed="${state.dia===i}">${n.slice(0,3)}</button>`).join('');
 tabs.querySelectorAll('[data-dia]').forEach(b=>b.onclick=()=>{state.dia=Number(b.dataset.dia);renderDia();});
 const a=diaAtual().exercicios,board=$('itens');
 board.innerHTML=a.length?a.map((it,i)=>`<div class="item avn-workout-card" data-item-index="${i}" draggable="true"><div class="avn-workout-visual">${media(state.exercicios.find(e=>Number(e.id)===Number(it.exercicio_id)),true)}</div><div class="avn-workout-details"><div class="item-head"><span class="handle" title="Arrastar para reordenar" aria-label="Arrastar">⋮⋮</span><strong>${esc(buscarNome(it.exercicio_id))}</strong><button type="button" class="btn small avn-workout-action" data-trocar="${i}">Trocar exercício</button><button class="btn small ghost" data-up="${i}" aria-label="Mover para cima">↑</button><button class="btn small ghost" data-down="${i}" aria-label="Mover para baixo">↓</button><button class="btn danger small" data-del="${i}" aria-label="Remover">×</button></div><div class="fields">
 <label>Séries<input type="number" data-index="${i}" data-field="series" min="1" max="30" value="${it.series}"></label><label>Repetições<input data-index="${i}" data-field="repeticoes" maxlength="30" value="${esc(it.repeticoes)}"></label><label>Carga (kg)<input type="number" data-index="${i}" data-field="carga_kg" min="0" max="2000" step="0.5" value="${esc(it.carga_kg??'')}"></label><label>Descanso (s)<input type="number" data-index="${i}" data-field="descanso_seg" min="0" max="3600" value="${it.descanso_seg}"></label></div>
 <label class="label">Observações<input data-index="${i}" data-field="observacoes" maxlength="500" value="${esc(it.observacoes)}" placeholder="Ex.: execução controlada"></label></div></div>`).join(''):`<div class="empty">${NOMES[state.dia]}: nenhum exercício. Use o botão + Adicionar exercício.</div>`;
 board.querySelectorAll('[data-field]').forEach(el=>el.addEventListener('input',()=>{const it=diaAtual().exercicios[Number(el.dataset.index)];it[el.dataset.field]=el.dataset.field==='carga_kg'?(el.value===''?null:Number(el.value)):['series','descanso_seg'].includes(el.dataset.field)?Number(el.value):el.value;}));
 board.querySelectorAll('[data-trocar]').forEach(b=>b.onclick=()=>abrirBiblioteca(Number(b.dataset.trocar)));
 board.querySelectorAll('[data-up]').forEach(b=>b.onclick=()=>mover(Number(b.dataset.up),Number(b.dataset.up)-1));
 board.querySelectorAll('[data-down]').forEach(b=>b.onclick=()=>mover(Number(b.dataset.down),Number(b.dataset.down)+1));
 board.querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>{diaAtual().exercicios.splice(Number(b.dataset.del),1);renderDia();});
 board.ondragover=e=>{e.preventDefault();board.classList.add('over');};board.ondragleave=e=>{if(!board.contains(e.relatedTarget))board.classList.remove('over');};
 board.ondrop=e=>{e.preventDefault();board.classList.remove('over');const idx=Number(e.target.closest('[data-item-index]')?.dataset.itemIndex??a.length);const exId=e.dataTransfer.getData('text/avn-exercicio-id');const itemIndex=e.dataTransfer.getData('text/avn-item-index');if(exId&&isId(exId))addExercicio(Number(exId),idx);else if(itemIndex!==''){const from=Number(itemIndex);mover(from,Math.min(idx,a.length-1));}};
 board.querySelectorAll('[data-item-index]').forEach(el=>{
  el.addEventListener('dragstart',e=>{if(['INPUT','TEXTAREA','BUTTON'].includes(e.target.tagName)){e.preventDefault();return;}e.dataTransfer.setData('text/avn-item-index',el.dataset.itemIndex);e.dataTransfer.effectAllowed='move';el.classList.add('dragging');});
  el.addEventListener('dragend',()=>el.classList.remove('dragging'));
  const handle=el.querySelector('.handle');let startIdx=null,movedTo=null;
  handle.addEventListener('pointerdown',e=>{if(e.pointerType==='mouse')return;startIdx=Number(el.dataset.itemIndex);movedTo=startIdx;handle.setPointerCapture(e.pointerId);e.preventDefault();});
  handle.addEventListener('pointermove',e=>{if(startIdx===null)return;const at=document.elementFromPoint(e.clientX,e.clientY)?.closest('[data-item-index]');if(at&&board.contains(at))movedTo=Number(at.dataset.itemIndex);});
  handle.addEventListener('pointerup',()=>{if(startIdx!==null){const from=startIdx,to=movedTo;startIdx=null;movedTo=null;if(from!==to)mover(from,to);}});
  handle.addEventListener('pointercancel',()=>{startIdx=null;movedTo=null;});
 });
}
async function salvarPlano(){if(!state.plano.nome.trim())return toast('Informe o nome do plano.',true);const id=state.plano.id;try{
  const url='/planos'+(id?'/'+id:'');const result=await fetchJSON(url,{method:id?'PUT':'POST',body:JSON.stringify(state.plano)});state.plano.id=result.id;await atualizarSeletorPlanos();$('excluirPlano')&&($('excluirPlano').disabled=false);toast('Treino salvo no PostgreSQL.');
 }catch(e){toast(e.message,true);}}

async function atualizarSeletorPlanos(){try{const planos=await fetchJSON('/planos?usuario_id='+state.usuarioId);const sel=$('selecionarPlano');if(!sel)return;sel.innerHTML='<option value="">Selecione um programa salvo…</option>'+planos.map(p=>`<option value="${p.id}" ${String(p.id)===String(state.plano?.id)?'selected':''}>${esc(p.nome)}</option>`).join('');}catch(e){toast(e.message,true);}}
function abrirModalIA(){
 let modal=$('avn-modal-ia');if(!modal){modal=document.createElement('dialog');modal.id='avn-modal-ia';modal.className='avn-modal-ia';document.body.appendChild(modal);}
 modal.innerHTML=`<div class="avn-ai-head"><h2>✦ Assistente IA</h2><button class="btn ghost" id="fecharIaOpcoes">Fechar ×</button></div><p>Selecione uma ação para o planejamento semanal.</p><div class="row"><button class="btn primary" id="iaCriar">Criar treino</button><button class="btn primary" id="iaAvaliar">Avaliar treino aberto</button></div>`;
 modal.querySelector('#fecharIaOpcoes').onclick=()=>modal.close();
 modal.querySelector('#iaCriar').onclick=()=>abrirCriacaoIA();
 modal.querySelector('#iaAvaliar').onclick=()=>avaliarTreinoAberto();
 if(!modal.open)modal.showModal();
}
async function avaliarTreinoAberto(){
 const modal=$('avn-modal-ia'),copia=JSON.parse(JSON.stringify(state.plano));
 modal.innerHTML=`<div class="avn-ai-head"><h2>✦ Avaliação crítica do treino</h2><button type="button" class="btn ghost" id="fecharAvaliacao">Fechar ×</button></div><div id="resultadoAvaliacao" aria-live="polite">Analisando treino, perfil, medições, equipamentos e nutrição…</div>`;
 modal.querySelector('#fecharAvaliacao').onclick=()=>modal.close();
 const area=modal.querySelector('#resultadoAvaliacao');
 try{
  const result=await fetchJSON('/ia/avaliar',{method:'POST',body:JSON.stringify({usuario_id:state.usuarioId,plano:copia})});if(!modal.open)return;
  const applied=new Set();
  area.innerHTML=`<section class="avn-ai-report"><h3>Veredito: ${esc(result.veredito?.toUpperCase())}</h3><p>${esc(result.analise)}</p><h4>Nutrição e recuperação</h4><p>${esc(result.nutricao_e_recuperacao)}</p><h4>Pontos críticos</h4><ul>${(result.pontos_criticos||[]).map(x=>`<li>${esc(x)}</li>`).join('')||'<li>Nenhum informado.</li>'}</ul><h3>Sugestões aplicáveis</h3>${(result.sugestoes||[]).map((s,i)=>`<div class="avn-ai-recommendation"><div class="row"><strong>${esc(NOMES[s.dia_semana]||'Dia')} · ${esc(s.descricao)}</strong><button class="btn primary small" data-aplicar-dica="${i}">Aplicar</button></div><p>${esc(s.justificativa)}</p></div>`).join('')||'<p>Nenhuma alteração indicada.</p>'}<p class="hint">Cada sugestão altera apenas o editor; clique Salvar treino para persistir.</p></section>`;
  area.querySelectorAll('[data-aplicar-dica]').forEach(b=>b.onclick=()=>{
   const i=Number(b.dataset.aplicarDica),s=result.sugestoes[i];if(!s||applied.has(i))return;
   const day=state.plano.dias.find(d=>Number(d.dia_semana)===s.dia_semana),baseline=copia.dias.find(d=>Number(d.dia_semana)===s.dia_semana);
   if(!day){toast('Dia não encontrado.',true);return;}
   const items=day.exercicios,base=baseline?.exercicios[s.posicao];
   let pos=s.posicao;
   if(s.acao!=='adicionar'){
    if(!base){toast('Posição original não encontrada. Faça uma nova avaliação.',true);return;}
    pos=items.findIndex(x=>Number(x.exercicio_id)===Number(base.exercicio_id));
    if(pos<0){toast('Exercício já modificado. Reavalie para continuar.',true);return;}
   }
   if(s.acao==='adicionar'&&Number(s.exercicio_id)>0)items.splice(Math.min(pos,items.length),0,{exercicio_id:s.exercicio_id,series:s.series||3,repeticoes:s.repeticoes||'10',carga_kg:null,descanso_seg:s.descanso_seg??60,observacoes:''});
   else if(s.acao==='remover')items.splice(pos,1);
   else if(s.acao==='trocar'&&Number(s.exercicio_id)>0)items[pos].exercicio_id=s.exercicio_id;
   else if(s.acao==='ajustar'){if(s.series!=null)items[pos].series=s.series;if(s.repeticoes!=null)items[pos].repeticoes=s.repeticoes;if(s.descanso_seg!=null)items[pos].descanso_seg=s.descanso_seg;}
   else return;
   applied.add(i);state.dia=s.dia_semana;renderDia();b.disabled=true;b.textContent='Aplicada ✓';toast('Sugestão aplicada no editor. Salve o treino ao terminar.');
  });
 }catch(e){if(modal.open)area.textContent='Erro na avaliação: '+e.message;}
}
let sugestaoIA=null;
async function abrirCriacaoIA(){
 let modal=$('avn-modal-ia');if(!modal){modal=document.createElement('dialog');modal.id='avn-modal-ia';modal.className='avn-modal-ia';document.body.appendChild(modal);}
 sugestaoIA=null;
 modal.innerHTML=`<div class="avn-ai-head"><h2>✦ Análise física e sugestão de treino</h2><button type="button" class="btn ghost" id="fecharModalIA">Fechar ×</button></div><p>A IA usará o Perfil de Treinamento, a avaliação física registrada e somente exercícios compatíveis com Minha Academia. Não modificará o programa até você confirmar.</p><div id="avn-resposta-ia" aria-live="polite">Consultando suas medições e preparando sugestão…</div><div class="row" style="justify-content:flex-end;margin-top:16px"><button type="button" class="btn primary" id="aplicarSugestao" disabled>Aplicar programa</button></div>`;
 modal.querySelector('#fecharModalIA').onclick=()=>modal.close();if(!modal.open)modal.showModal();
 const saida=modal.querySelector('#avn-resposta-ia'),aplicar=modal.querySelector('#aplicarSugestao');
 aplicar.onclick=()=>{if(!sugestaoIA||!confirm('Substituir o programa atualmente aberto no Montador pela sugestão da IA? As alterações só serão gravadas ao clicar em Salvar treino.'))return;state.plano={...novoPlano(),nome:sugestaoIA.nome,descricao:sugestaoIA.descricao||'',dias:NOMES.map((_,d)=>({dia_semana:d,exercicios:(sugestaoIA.dias.find(x=>x.dia_semana===d)?.exercicios||[]).map(i=>({exercicio_id:i.exercicio_id,series:i.series,repeticoes:i.repeticoes,carga_kg:null,descanso_seg:i.descanso_seg,observacoes:i.observacoes||''}))}))};state.dia=0;modal.close();htmlMontador();toast('Sugestão aplicada no editor. Clique em Salvar treino para gravar.');};
 try {const result=await fetchJSON('/ia/sugerir',{method:'POST',body:JSON.stringify({usuario_id:state.usuarioId})});if(!modal.open)return;sugestaoIA=result.programa;saida.innerHTML=`<section class="avn-ai-report"><h3>Parecer sobre os dados atuais</h3><p>${esc(result.avaliacao.resumo)}</p><h4>Dados utilizados</h4><ul>${result.dados.map(x=>`<li>${esc(x.codigo)}: ${esc(x.valor)} (${esc(x.data_medicao)}; ${esc(x.origem)})</li>`).join('')||'<li>Sem medições recentes disponíveis</li>'}</ul><h4>Perfil de treinamento</h4><p>${esc(result.perfil?.nivel||'Não informado')} · ${esc(result.perfil?.regularidade||'')} · ${esc(result.perfil?.objetivo||'')}</p><p>${result.diagnostico_equipamentos?.exercicios_compativeis??0} exercícios compatíveis com o inventário.</p><h4>Limitações e pontos de atenção</h4><p>${esc(result.avaliacao.limitacoes)}</p><h3>Programa semanal sugerido</h3>${NOMES.map((nome,i)=>{const dia=result.programa.dias.find(x=>x.dia_semana===i);return `<div class="avn-ai-day"><strong>${nome}</strong><p>${esc(dia?.objetivo||'Recuperação')}</p>${(dia?.exercicios||[]).map(e=>`<div>${esc(buscarNome(e.exercicio_id))} · ${e.series} × ${esc(e.repeticoes)} · ${e.descanso_seg}s</div>`).join('')||'<small>Sem exercícios programados</small>'}</div>`}).join('')}</section>`;aplicar.disabled=false;
 }catch(e){if(modal.open)saida.textContent='Não foi possível gerar a sugestão: '+e.message;}
}

async function meusTreinos(){if(usuarioGuard())return;state.planos=await fetchJSON('/planos?usuario_id='+state.usuarioId);const r=$('conteudo');r.innerHTML=`<div class="card stack"><div class="row between"><h2>Planos de ${esc(state.usuarios.find(u=>String(u.id)===state.usuarioId)?.nome||'usuário')}</h2><a href="/avn/sistema/montador" class="btn primary">+ Criar treino</a></div><div class="list-rows" id="listaPlanos"></div></div>`;
 $('listaPlanos').innerHTML=state.planos.length?state.planos.map(p=>`<div class="plan"><div><strong>${esc(p.nome)}</strong><small>${esc(p.descricao||'Sem descrição')} · Atualizado em ${new Date(p.atualizado_em).toLocaleDateString('pt-BR')}</small></div><div class="row"><a class="btn small" href="/avn/sistema/montador?plano=${p.id}">Editar</a><a class="btn small primary" href="/avn/sistema/treinar?plano=${p.id}">Executar</a><button class="btn danger small" data-del="${p.id}">Excluir</button></div></div>`).join(''):'<div class="empty">Nenhum plano salvo. Crie o primeiro no Montador.</div>';
 document.querySelectorAll('#listaPlanos [data-del]').forEach(b=>b.onclick=async()=>{if(!confirm('Arquivar este treino? Sessões já registradas serão preservadas.'))return;try{await fetchJSON('/planos/'+b.dataset.del,{method:'DELETE'});toast('Plano arquivado.');await meusTreinos();}catch(e){toast(e.message,true);}});
}
async function treinoPlanos(){if(usuarioGuard())return;state.planos=await fetchJSON('/planos?usuario_id='+state.usuarioId);const wanted=new URLSearchParams(location.search).get('plano');const planId=state.treino?.id|| (state.planos.some(x=>String(x.id)===wanted)?wanted:state.planos[0]?.id);
 const r=$('conteudo');if(!planId){r.innerHTML='<div class="empty">Crie um plano no Montador antes de registrar uma sessão.</div>';return;}
 await carregarTreino(planId);r.innerHTML=`<div class="grid-2"><section class="card stack"><h2>Selecionar treino</h2><label class="label">Plano<select id="selectPlano">${state.planos.map(p=>`<option value="${p.id}" ${String(p.id)===String(planId)?'selected':''}>${esc(p.nome)}</option>`).join('')}</select></label><label class="label">Dia<select id="selectDia">${NOMES.map((name,i)=>`<option value="${i}">${name}</option>`).join('')}</select></label><p class="hint">A sessão será registrada apenas quando você confirmar.</p><div id="treinoItens"></div><label class="label">Observações da sessão<textarea id="sessaoObs" maxlength="1000"></textarea></label><button id="salvarSessao" class="btn primary">Registrar sessão realizada</button></section><section class="card stack"><h2>Histórico recente</h2><div id="historico" class="list-rows"></div></section></div>`;
 $('selectPlano').onchange=async()=>{try{await carregarTreino($('selectPlano').value);$('selectDia').value=String(state.treinoDia);renderTreinoItens();}catch(e){toast(e.message,true);}};
 $('selectDia').onchange=()=>{state.treinoDia=Number($('selectDia').value);renderTreinoItens();};
 $('salvarSessao').onclick=salvarSessao;
 $('selectDia').value=String(state.treinoDia);renderTreinoItens();await renderHistorico();await configurarAndroidNoRegistro();
}

async function configurarAndroidNoRegistro(){
 const card=document.querySelector('#conteudo .grid-2 > section:nth-child(2)');
 if(!card)return;
 const area=document.createElement('div');area.className='stack';
 area.innerHTML='<h3>Treinos no Android</h3><button type="button" class="btn ghost" id="vincularAvnAndroid">Vincular Android</button><p id="codigoAvnAndroid" class="hint">Gere um código de pareamento para o aplicativo Android.</p><div id="historicoAvnAndroid" class="list-rows"></div>';
 card.appendChild(area);
 $('vincularAvnAndroid').onclick=async()=>{try{
   const d=await fetchJSON('/mobile/pareamento',{method:'POST',body:JSON.stringify({usuario_id:state.usuarioId})});
   $('codigoAvnAndroid').textContent='Código válido por 10 minutos: '+d.codigo;
   prompt('Código de pareamento para o Android AVN:',d.codigo);
 }catch(e){toast(e.message,true);}};
 try{
  const sessoes=await fetchJSON('/mobile/execucoes?usuario_id='+state.usuarioId);
  $('historicoAvnAndroid').innerHTML=sessoes.length?sessoes.map(s=>'<div class="plan"><div><strong>'+esc(s.plano_nome)+'</strong><small>'+esc(NOMES[s.dia_semana])+' · '+esc(new Date(s.iniciada_em).toLocaleString('pt-BR'))+' · '+esc(s.series_concluidas)+' séries · '+esc(s.status)+'</small></div><button type="button" class="btn small" data-avn-android-exec="'+esc(s.id)+'">Detalhes</button></div>').join(''):'<div class="empty">Nenhum treino do Android registrado ainda.</div>';
  area.querySelectorAll('[data-avn-android-exec]').forEach(b=>b.onclick=async()=>{try{
    const d=await fetchJSON('/mobile/execucoes/'+b.dataset.avnAndroidExec);
    alert('Treino '+d.plano_nome+'\n'+d.eventos.map(e=>e.tipo+' · Exercício '+(e.exercicio_id||'')+' · Série '+(e.numero_serie||'')+' · '+(e.carga_kg??'')+' kg · '+(e.repeticoes??'')+' rep.').join('\n'));
  }catch(e){toast(e.message,true);}});
 }catch(e){toast('Histórico Android indisponível: '+e.message,true);}
}

async function carregarTreino(id){state.treino=await fetchJSON('/planos/'+id);if(String(state.treino.usuario_id)!==state.usuarioId)throw Error('Plano não pertence ao usuário.');if(!state.treino.dias.some(d=>Number(d.dia_semana)===state.treinoDia&&d.exercicios.length)){state.treinoDia=Number(state.treino.dias.find(d=>d.exercicios.length)?.dia_semana??0);}}
function renderTreinoItens(){const day=state.treino.dias.find(d=>Number(d.dia_semana)===state.treinoDia),itens=day?.exercicios||[];
 const root=$('treinoItens');root.innerHTML=itens.length?`<div class="stack">`+itens.map((i,n)=>`<div class="item" data-realizado="${n}"><div class="row between"><strong>${esc(i.exercicio_nome||buscarNome(i.exercicio_id))}</strong><span class="pill">Previsto: ${i.series} × ${esc(i.repeticoes)}</span></div><div class="fields"><label>Séries feitas<input type="number" class="ses-series" min="0" max="30" value="${i.series}"></label><label>Repetições feitas<input class="ses-reps" maxlength="30" value="${esc(i.repeticoes)}"></label><label>Carga (kg)<input type="number" class="ses-carga" min="0" max="2000" step="0.5" value="${esc(i.carga_kg??'')}"></label></div><label class="label">Observação<input class="ses-obs" maxlength="500"></label></div>`).join('')+'</div>':'<div class="empty">Este dia não possui exercícios. Escolha outro dia ou edite o plano.</div>';
 $('salvarSessao').disabled=!itens.length;
}
async function renderHistorico(){const r=await fetchJSON('/sessoes?usuario_id='+state.usuarioId);$('historico').innerHTML=r.length?r.map(x=>`<div class="plan"><div><strong>${esc(x.plano_nome)}</strong><small>${NOMES[x.dia_semana]} · ${new Date(x.realizado_em).toLocaleString('pt-BR')} · ${x.total_exercicios} exercícios</small></div><button class="btn small" data-ver-sessao="${x.id}">Detalhes</button></div>`).join(''):'<div class="empty">Ainda não há sessões registradas.</div>';document.querySelectorAll('[data-ver-sessao]').forEach(b=>b.onclick=async()=>{try{const d=await fetchJSON('/sessoes/'+b.dataset.verSessao);const lines=d.exercicios.map(x=>`${x.nome}: ${x.series_realizadas} série(s), ${x.repeticoes_realizadas} rep., ${x.carga_kg??'-'} kg`).join('\n');alert(`${d.plano_nome} — ${NOMES[d.dia_semana]}\n${new Date(d.realizado_em).toLocaleString('pt-BR')}\n\n${lines}`);}catch(e){toast(e.message,true);}});}
async function salvarSessao(){const d=state.treino.dias.find(x=>Number(x.dia_semana)===state.treinoDia),itens=d?.exercicios||[];
 const cards=[...document.querySelectorAll('[data-realizado]')];if(cards.length!==itens.length||!cards.length)return toast('Dia sem exercícios.',true);
 const realizados=cards.map((c,index)=>({exercicio_id:itens[index].exercicio_id,series_realizadas:Number(c.querySelector('.ses-series').value),repeticoes_realizadas:c.querySelector('.ses-reps').value,carga_kg:c.querySelector('.ses-carga').value===''?null:Number(c.querySelector('.ses-carga').value),observacoes:c.querySelector('.ses-obs').value}));
 if(!confirm('Confirmar o registro desta sessão como realizada?'))return;
 try{await fetchJSON('/sessoes',{method:'POST',body:JSON.stringify({usuario_id:state.usuarioId,plano_id:state.treino.id,dia_semana:state.treinoDia,realizados,observacoes:$('sessaoObs').value})});$('sessaoObs').value='';toast('Sessão registrada.');await renderHistorico();}catch(e){toast(e.message,true);}}
function debounce(fn,ms){let handle;return(...args)=>{clearTimeout(handle);handle=setTimeout(()=>Promise.resolve(fn(...args)).catch(e=>toast(e.message,true)),ms);};}
async function show(){if(page==='exercicios'){htmlExercicios();return;}if(usuarioGuard())return;if(page==='montador'){
 state.plano=novoPlano();const from=new URLSearchParams(location.search).get('plano');if(isId(from))await carregarPlano(from);htmlMontador();
 }else if(page==='meus-treinos')await meusTreinos();else if(page==='treinar')await treinoPlanos();}
(async()=>{try{await users();await base();await show();}catch(e){$('conteudo').innerHTML='<div class="empty">Não foi possível carregar o AVN. '+esc(e.message)+'</div>';toast(e.message,true);}})();
})();
