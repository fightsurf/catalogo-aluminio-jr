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
const isAnimated = url => typeof url==='string' && url.includes('/bryllim/workout-guide@') && /\/frame-1\.svg(?:$|[?#])/.test(url);
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
 return `<img class="thumb ${isAnimated(ex.midia_url)?'avn-animated':''}" src="${url}" data-base="${url}" alt="Demonstração ilustrada: ${name}" loading="lazy" referrerpolicy="no-referrer" onerror="this.onerror=null;this.classList.add('media-missing');this.alt='Imagem indisponível';">`;
}
function selectGrupos(){return `<option value="">Todos os grupos</option>`+state.grupos.map(g=>`<option value="${esc(g.slug)}" ${state.grupo===g.slug?'selected':''}>${esc(g.nome)}</option>`).join('');}
function usuarioGuard(){if(state.usuarioId)return false;$('conteudo').innerHTML='<div class="empty">Cadastre e selecione um usuário na Central AVN para começar.</div>';return true;}
function campo(nome,id,value='',type='text',extra=''){return `<label class="label">${nome}<input id="${id}" type="${type}" value="${esc(value)}" ${extra}></label>`;}
function preview(ex){if(!ex?.midia_url)return '<div class="empty">Sem demonstração cadastrada. Use somente mídia com licença de uso.</div>';
 const url=esc(ex.midia_url);
 return ex.midia_tipo==='video'?`<video class="media-preview" src="${url}" controls playsinline preload="metadata"></video>`:`<img class="media-preview ${isAnimated(ex.midia_url)?'avn-animated':''}" data-base="${url}" src="${url}" alt="Demonstração ilustrada" loading="lazy">`;
}
function htmlExercicios(){
  $('conteudo').innerHTML=`<section class="grid-2"><div class="card stack"><div class="row between"><h2>Consultar exercícios</h2><button class="btn small" type="button" id="syncCatalog">Atualizar ilustrações</button></div><div class="filters">${campo('Pesquisar (ignora acentos)','busca',state.filtro,'search','placeholder="Ex.: rosca scott"')}<label class="label">Grupo muscular<select id="grupo">${selectGrupos()}</select></label></div><span class="hint" id="quantidade"></span><div id="lista-exercicios" class="exercise-list"></div></div>
  <div class="card stack"><div class="row between"><h2 id="formTitle">Cadastrar exercício</h2><button class="btn small" id="novoExercicio">Novo</button></div>
  <form id="formExercicio" class="stack"><input type="hidden" id="exId"><label class="label">Nome<input id="exNome" maxlength="160" required></label>
  <div class="filters"><label class="label">Grupo<select id="exGrupo" required>${state.grupos.map(g=>`<option value="${g.id}">${esc(g.nome)}</option>`).join('')}</select></label>${campo('Equipamento','exEquip','Livre','text','maxlength="100"')}</div>
  <label class="label">Instruções<textarea id="exInstrucoes" maxlength="5000"></textarea></label>
  <div class="filters"><label class="label">Tipo de mídia<select id="exTipo"><option value="imagem">Imagem</option><option value="gif">GIF animado / SVG</option><option value="video">Vídeo MP4/WebM</option></select></label>${campo('URL HTTPS licenciada','exMidia','','url','placeholder="https://..."')}</div>
  <div id="exPreview" class="empty">Demonstração não cadastrada</div><div class="row"><button type="submit" class="btn primary">Salvar exercício</button><button type="button" class="btn danger hide" id="exDesativar">Desativar</button></div></form>
  <p class="hint">Ilustrações originais: <a href="https://github.com/bryllim/workout-guide" target="_blank" rel="noopener noreferrer">Workout Guide / Bryl Lim</a>, com base no <a href="https://github.com/everkinetic/data" target="_blank" rel="noopener noreferrer">Everkinetic</a>. Imagens CC BY-SA 4.0. Adaptação: exibição cíclica de três quadros. Consulte <a href="https://github.com/bryllim/workout-guide/blob/main/ATTRIBUTION.md" target="_blank" rel="noopener noreferrer">créditos e alterações</a>. Nomes traduzidos ou adaptados no AVN. O carregamento externo exige conexão.</p></div></section>`;
  $('busca').oninput=debounce(async()=>{state.filtro=$('busca').value;await buscarExercicios();renderExerciciosLista();},250);
  $('grupo').onchange=async()=>{state.grupo=$('grupo').value;await buscarExercicios();renderExerciciosLista();};
  $('syncCatalog').onclick=async()=>{const b=$('syncCatalog');b.disabled=true;b.textContent='Sincronizando…';try{const r=await fetchJSON('/catalogo/sincronizar',{method:'POST'});toast(r.total+' exercícios processados.');state.grupos=await fetchJSON('/grupos');await buscarExercicios();htmlExercicios();}catch(e){toast('Falha ao importar. O catálogo local continua disponível: '+e.message,true);b.disabled=false;b.textContent='Atualizar ilustrações';}};
  $('novoExercicio').onclick=()=>fillEx(null);
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
 list.querySelectorAll('[data-editar]').forEach(b=>b.onclick=()=>fillEx(state.exercicios.find(e=>String(e.id)===b.dataset.editar)));
}
function fillEx(e){$('formTitle').textContent=e?'Editar exercício':'Cadastrar exercício';$('exId').value=e?.id||'';$('exNome').value=e?.nome||'';$('exGrupo').value=e?.grupo_id||state.grupos[0]?.id||'';$('exEquip').value=e?.equipamento||'Livre';$('exInstrucoes').value=e?.instrucoes||'';$('exTipo').value=e?.midia_tipo||'imagem';$('exMidia').value=e?.midia_url||'';$('exDesativar').classList.toggle('hide',!e);atualizarPreview();}
function atualizarPreview(){const url=$('exMidia').value.trim();$('exPreview').innerHTML=/^https:\/\//i.test(url)?preview({midia_url:url,midia_tipo:$('exTipo').value}):'<div class="empty">Informe a URL HTTPS de uma mídia licenciada.</div>';}
async function salvarExercicio(evt){evt.preventDefault();const id=$('exId').value;const body={nome:$('exNome').value,grupo_id:$('exGrupo').value,equipamento:$('exEquip').value,instrucoes:$('exInstrucoes').value,midia_tipo:$('exTipo').value,midia_url:$('exMidia').value};
 try{await fetchJSON('/exercicios'+(id?'/'+id:''),{method:id?'PUT':'POST',body:JSON.stringify(body)});toast('Exercício salvo.');await buscarExercicios();renderExerciciosLista();fillEx(null);}catch(e){toast(e.message,true);}}
async function desativarExercicio(){const id=$('exId').value;if(!id||!confirm('Desativar este exercício? Ele permanecerá nos treinos históricos.'))return;
 try{await fetchJSON('/exercicios/'+id,{method:'DELETE'});await buscarExercicios();renderExerciciosLista();fillEx(null);toast('Exercício desativado.');}catch(e){toast(e.message,true);}}
function novoPlano(){return {id:null,usuario_id:Number(state.usuarioId),nome:'Treino semanal',descricao:'',dias:NOMES.map((_,i)=>({dia_semana:i,exercicios:[]}))};}
function diaAtual(){return state.plano.dias.find(d=>Number(d.dia_semana)===state.dia);}
function getDia(exercicios,day){let d=exercicios.find(x=>Number(x.dia_semana)===day);if(!d){d={dia_semana:day,exercicios:[]};exercicios.push(d);}return d;}
function buscarNome(id){return state.nomes.get(Number(id)) || 'Exercício '+id;}
async function carregarPlano(id){const p=await fetchJSON('/planos/'+id);if(String(p.usuario_id)!==String(state.usuarioId))throw Error('Esse plano pertence a outro usuário.');state.plano=p;for(let i=0;i<7;i++)getDia(state.plano.dias,i);}
function listagemExerciciosMontador(){return state.exercicios.length?state.exercicios.map(e=>`<div class="exercise" draggable="true" data-exercicio="${e.id}">${media(e,true)}<div class="grow"><strong>${esc(e.nome)}</strong><small>${esc(e.grupo)} · ${esc(e.equipamento)}</small></div><button class="btn primary small" data-add="${e.id}" title="Adicionar ao dia selecionado">+ Adicionar</button></div>`).join(''):'<div class="empty">Sem exercícios para este filtro.</div>';}
function htmlMontador(){
 $('conteudo').innerHTML=`<div class="grid-2"><aside class="card stack"><h2>Biblioteca</h2><div class="filters">${campo('Buscar exercício','busca',state.filtro,'search','placeholder="Digite um nome"')}<label class="label">Grupo<select id="grupo">${selectGrupos()}</select></label></div><p class="hint">Arraste um exercício para a lista ou clique em “Adicionar” (recomendado no celular).</p><div class="exercise-list" id="listaMontador"></div></aside>
 <section class="card stack"><div class="row between"><h2>Planejamento semanal</h2><span class="pill">7 dias</span></div>${campo('Nome do plano','nomePlano',state.plano.nome,'text','maxlength="160" required')}<label class="label">Descrição<input id="descPlano" maxlength="4000" value="${esc(state.plano.descricao)}"></label>
 <div class="day-tabs" id="dias"></div><p class="hint">Arraste pelo ícone ⋮⋮ para reordenar. Também existem botões ↑ e ↓.</p>
 <div class="dropzone" id="itens" aria-label="Exercícios do dia selecionado"></div>
 <div class="row"><button class="btn primary" id="salvarPlano">Salvar treino</button><button class="btn ghost" id="limparDia">Limpar dia</button><button class="btn ghost" id="novoPlano">Novo plano</button></div></section></div>`;
 $('nomePlano').oninput=e=>state.plano.nome=e.target.value;
 $('descPlano').oninput=e=>state.plano.descricao=e.target.value;
 $('busca').oninput=debounce(async()=>{state.filtro=$('busca').value;try{await buscarExercicios();renderLibraryBuilder();}catch(e){toast(e.message,true);}},200);
 $('grupo').onchange=async()=>{state.grupo=$('grupo').value;try{await buscarExercicios();renderLibraryBuilder();}catch(e){toast(e.message,true);}};
 $('salvarPlano').onclick=salvarPlano;
 $('limparDia').onclick=()=>{if(confirm('Remover todos os exercícios deste dia?')){diaAtual().exercicios=[];renderDia();}};
 $('novoPlano').onclick=()=>{if(confirm('Começar um novo plano sem salvar alterações pendentes?')){state.plano=novoPlano();state.dia=0;htmlMontador();}};
 renderLibraryBuilder();renderDia();
}
function renderLibraryBuilder(){const list=$('listaMontador');if(!list)return;list.innerHTML=listagemExerciciosMontador();list.querySelectorAll('[data-add]').forEach(b=>b.onclick=()=>addExercicio(Number(b.dataset.add)));
 list.querySelectorAll('[data-exercicio]').forEach(el=>el.addEventListener('dragstart',e=>{e.dataTransfer.setData('text/avn-exercicio-id',el.dataset.exercicio);e.dataTransfer.effectAllowed='copy';}));}
function addExercicio(id,index){const a=diaAtual().exercicios;const i={exercicio_id:id,series:3,repeticoes:'10',carga_kg:null,descanso_seg:60,observacoes:''};if(index===undefined)a.push(i);else a.splice(index,0,i);renderDia();}
function mover(from,to){const a=diaAtual().exercicios;if(from===to||from<0||to<0||from>=a.length||to>=a.length)return;const [x]=a.splice(from,1);a.splice(to,0,x);renderDia();}
function renderDia(){
 const tabs=$('dias');if(!tabs)return;tabs.innerHTML=NOMES.map((n,i)=>`<button class="btn small ${state.dia===i?'selected':''}" data-dia="${i}" aria-pressed="${state.dia===i}">${n.slice(0,3)}</button>`).join('');
 tabs.querySelectorAll('[data-dia]').forEach(b=>b.onclick=()=>{state.dia=Number(b.dataset.dia);renderDia();});
 const a=diaAtual().exercicios,board=$('itens');
 board.innerHTML=a.length?a.map((it,i)=>`<div class="item" data-item-index="${i}" draggable="true"><div class="item-head"><span class="handle" title="Arrastar para reordenar" aria-label="Arrastar">⋮⋮</span><strong>${esc(buscarNome(it.exercicio_id))}</strong><button class="btn small ghost" data-up="${i}" aria-label="Mover para cima">↑</button><button class="btn small ghost" data-down="${i}" aria-label="Mover para baixo">↓</button><button class="btn danger small" data-del="${i}" aria-label="Remover">×</button></div><div class="fields">
 <label>Séries<input type="number" data-index="${i}" data-field="series" min="1" max="30" value="${it.series}"></label><label>Repetições<input data-index="${i}" data-field="repeticoes" maxlength="30" value="${esc(it.repeticoes)}"></label><label>Carga (kg)<input type="number" data-index="${i}" data-field="carga_kg" min="0" max="2000" step="0.5" value="${esc(it.carga_kg??'')}"></label><label>Descanso (s)<input type="number" data-index="${i}" data-field="descanso_seg" min="0" max="3600" value="${it.descanso_seg}"></label></div>
 <label class="label">Observações<input data-index="${i}" data-field="observacoes" maxlength="500" value="${esc(it.observacoes)}" placeholder="Ex.: execução controlada"></label></div>`).join(''):`<div class="empty">${NOMES[state.dia]}: nenhum exercício. Arraste da biblioteca ou use + Adicionar.</div>`;
 board.querySelectorAll('[data-field]').forEach(el=>el.addEventListener('input',()=>{const it=diaAtual().exercicios[Number(el.dataset.index)];it[el.dataset.field]=el.dataset.field==='carga_kg'?(el.value===''?null:Number(el.value)):['series','descanso_seg'].includes(el.dataset.field)?Number(el.value):el.value;}));
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
  const url='/planos'+(id?'/'+id:'');const result=await fetchJSON(url,{method:id?'PUT':'POST',body:JSON.stringify(state.plano)});state.plano.id=result.id;toast('Treino salvo no PostgreSQL.');
 }catch(e){toast(e.message,true);}}
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
 $('selectDia').value=String(state.treinoDia);renderTreinoItens();await renderHistorico();
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
