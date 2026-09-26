(() => {
  const $ = id => document.getElementById(id);
  const state = { apps: [], categories: [], selectedCategory: null, query: '', managerQuery: '', draggingRoute: null };
  const icon = name => `<i data-lucide="${name || 'app-window'}"></i>`;
  const esc = v => String(v ?? '').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const norm = v => String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const refreshIcons = () => window.lucide && window.lucide.createIcons();

  function toast(msg, bad=false){ const el=$('toast'); el.textContent=msg; el.className=`toast ${bad?'bad':''}`; el.hidden=false; clearTimeout(toast.t); toast.t=setTimeout(()=>el.hidden=true,2600); }
  function visibleApps(){ return state.apps.filter(a=>a.visibilidade!=='oculto'); }
  function matches(app,q){ if(!q)return true; const h=norm(`${app.nome} ${app.categoria} ${app.descricao} ${app.rota}`); return h.includes(norm(q)); }

  function appCard(app, manager=false){
    const el=document.createElement(manager?'div':'a');
    if(!manager) el.href=app.rota;
    el.className=`app-card ${manager?'manager-app':''} visibility-${app.visibilidade}`;
    if(manager){ el.draggable=true; el.dataset.route=app.rota; }
    el.innerHTML=`<span class="app-icon">${icon(app.icone)}</span><span class="app-copy"><strong>${esc(app.nome)}</strong><span>${esc(app.descricao)}</span>${manager?`<small>${esc(app.rota)}</small>`:''}</span>${app.favorito?`<span class="fav">${icon('star')}</span>`:''}${manager?`<button class="edit-btn" title="Editar">${icon('pencil')}</button>`:''}`;
    if(manager){
      el.addEventListener('dragstart',e=>{ state.draggingRoute=app.rota; e.dataTransfer.effectAllowed='move'; e.dataTransfer.setData('text/plain',app.rota); el.classList.add('dragging'); });
      el.addEventListener('dragend',()=>{ state.draggingRoute=null; el.classList.remove('dragging'); document.querySelectorAll('.drop-active').forEach(x=>x.classList.remove('drop-active')); });
      el.querySelector('.edit-btn').addEventListener('click',e=>{e.stopPropagation();openEdit(app);});
      el.addEventListener('dblclick',()=>openEdit(app));
    }
    return el;
  }

  function categoryCard(category){
    const apps=visibleApps().filter(a=>a.categoria===category);
    const el=document.createElement('button'); el.className='category-card';
    el.innerHTML=`<span class="category-icon">${icon(categoryIcon(category))}</span><span><strong>${esc(category)}</strong><small>${apps.length} aplicativo${apps.length===1?'':'s'}</small></span><span class="chev">${icon('chevron-right')}</span>`;
    el.addEventListener('click',()=>selectCategory(category)); return el;
  }
  function categoryIcon(c){ const n=norm(c); if(n.includes('venda'))return'shopping-bag'; if(n.includes('produ'))return'factory'; if(n.includes('financ'))return'circle-dollar-sign'; if(n.includes('log'))return'truck'; if(n.includes('market'))return'megaphone'; if(n.includes('whatsapp'))return'message-circle'; if(n.includes('cad'))return'database'; if(n.includes('anal'))return'chart-column'; return'folder'; }

  function renderHome(){
    const q=state.query.trim();
    if(q){ renderSearch(); return; }
    $('categoriesSection').hidden=false; $('appsSection').hidden=true;
    const cats=[...new Set(visibleApps().map(a=>a.categoria))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
    $('categoryGrid').innerHTML=''; cats.forEach(c=>$('categoryGrid').appendChild(categoryCard(c))); $('categoryCount').textContent=`${cats.length} áreas`;
    const favs=visibleApps().filter(a=>a.favorito);
    $('favoritesSection').hidden=!favs.length; $('favoritesGrid').innerHTML=''; favs.forEach(a=>$('favoritesGrid').appendChild(appCard(a)));
    $('pageTitle').textContent='Aplicativos'; refreshIcons();
  }
  function renderSearch(){
    const apps=visibleApps().filter(a=>matches(a,state.query));
    $('categoriesSection').hidden=true; $('favoritesSection').hidden=true; $('appsSection').hidden=false;
    $('activeCategoryTitle').textContent=`Resultados para “${state.query}”`; $('appCount').textContent=`${apps.length} encontrados`;
    $('appsGrid').innerHTML=''; apps.forEach(a=>$('appsGrid').appendChild(appCard(a))); $('emptyState').hidden=!!apps.length; refreshIcons();
  }
  function selectCategory(category){ state.selectedCategory=category; $('categoriesSection').hidden=true; $('favoritesSection').hidden=true; $('appsSection').hidden=false; $('activeCategoryTitle').textContent=category; const apps=visibleApps().filter(a=>a.categoria===category&&matches(a,state.query)); $('appCount').textContent=`${apps.length} aplicativos`; $('appsGrid').innerHTML=''; apps.forEach(a=>$('appsGrid').appendChild(appCard(a))); $('emptyState').hidden=!!apps.length; refreshIcons(); }
  function render(){ state.query.trim()?renderSearch():(state.selectedCategory?selectCategory(state.selectedCategory):renderHome()); }

  function renderManager(){
    const board=$('managerBoard'); board.innerHTML='';
    const categories=[...new Set(state.apps.map(a=>a.categoria))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
    $('categoryOptions').innerHTML=categories.map(c=>`<option value="${esc(c)}"></option>`).join('');
    categories.forEach(category=>{
      const apps=state.apps.filter(a=>a.categoria===category&&matches(a,state.managerQuery));
      const lane=document.createElement('section'); lane.className='manager-lane'; lane.dataset.category=category;
      lane.innerHTML=`<div class="lane-head"><strong>${esc(category)}</strong><span>${apps.length}</span></div><div class="lane-drop"></div>`;
      const drop=lane.querySelector('.lane-drop'); apps.forEach(a=>drop.appendChild(appCard(a,true)));
      ['dragenter','dragover'].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault(); drop.classList.add('drop-active');}));
      drop.addEventListener('dragleave',e=>{ if(!drop.contains(e.relatedTarget)) drop.classList.remove('drop-active'); });
      drop.addEventListener('drop',async e=>{ e.preventDefault(); drop.classList.remove('drop-active'); const route=e.dataTransfer.getData('text/plain')||state.draggingRoute; const app=state.apps.find(a=>a.rota===route); if(app&&app.categoria!==category){ const old=app.categoria; app.categoria=category; renderManager(); try{await saveApp(app);toast(`Movido de ${old} para ${category}.`);}catch(err){app.categoria=old;renderManager();toast(err.message,true);} } });
      board.appendChild(lane);
    }); refreshIcons();
  }

  async function saveApp(app){
    const r=await fetch('/sistema/api/apps/config',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({rota:app.rota,nome:app.nome,categoria:app.categoria,visibilidade:app.visibilidade,favorito:app.favorito,ordem:app.ordem})});
    const data=await r.json().catch(()=>({})); if(!r.ok) throw new Error(data.erro||'Erro ao salvar configuração.');
    const i=state.apps.findIndex(a=>a.rota===app.rota); if(i>=0) state.apps[i]=data.app; return data.app;
  }
  function openEdit(app){ $('editRota').value=app.rota; $('editRoute').textContent=app.rota; $('editNome').value=app.nome; $('editCategoria').value=app.categoria; $('editVisibilidade').value=app.visibilidade||'principal'; $('editFavorito').checked=!!app.favorito; $('editDialog').showModal(); refreshIcons(); }
  function closeEdit(){ $('editDialog').close(); }

  async function loadApps(){
    $('refreshButton').classList.add('loading');
    try{ const r=await fetch('/sistema/api/apps',{cache:'no-store'}); if(!r.ok) throw new Error(`HTTP ${r.status}`); const data=await r.json(); state.apps=data.apps||[]; state.categories=data.categorias||[]; $('summaryText').textContent=`${data.visiveis ?? data.total} aplicativos visíveis em ${data.categorias.length} categorias. A organização fica salva no servidor.`; render(); if($('manager').classList.contains('open'))renderManager(); }
    catch(err){console.error(err);$('summaryText').textContent='Não foi possível carregar o catálogo.';toast('Erro ao carregar aplicativos.',true);} finally{$('refreshButton').classList.remove('loading');refreshIcons();}
  }

  $('searchInput').addEventListener('input',e=>{state.query=e.target.value;state.selectedCategory=null;render();});
  $('backButton').addEventListener('click',()=>{state.selectedCategory=null;state.query='';$('searchInput').value='';renderHome();});
  $('refreshButton').addEventListener('click',loadApps);
  $('manageButton').addEventListener('click',()=>{$('manager').classList.add('open');$('scrim').classList.add('open');$('manager').setAttribute('aria-hidden','false');renderManager();});
  function closeManager(){$('manager').classList.remove('open');$('scrim').classList.remove('open');$('manager').setAttribute('aria-hidden','true');}
  $('closeManager').addEventListener('click',closeManager); $('scrim').addEventListener('click',closeManager);
  $('managerSearch').addEventListener('input',e=>{state.managerQuery=e.target.value;renderManager();});
  $('closeEdit').addEventListener('click',closeEdit); $('cancelEdit').addEventListener('click',closeEdit);
  $('editForm').addEventListener('submit',async e=>{e.preventDefault(); const app=state.apps.find(a=>a.rota===$('editRota').value); if(!app)return; const original={...app}; app.nome=$('editNome').value.trim(); app.categoria=$('editCategoria').value.trim(); app.visibilidade=$('editVisibilidade').value; app.favorito=$('editFavorito').checked; try{await saveApp(app);closeEdit();render();renderManager();toast('Alterações salvas para todos os dispositivos.');}catch(err){Object.assign(app,original);toast(err.message,true);} });
  $('resetButton').addEventListener('click',async()=>{ const rota=$('editRota').value; if(!confirm('Restaurar nome, categoria e visibilidade automáticos deste aplicativo?'))return; try{const r=await fetch('/sistema/api/apps/config',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({rota})});const data=await r.json();if(!r.ok)throw new Error(data.erro||'Erro ao restaurar.');const i=state.apps.findIndex(a=>a.rota===rota);if(i>=0)state.apps[i]=data.app;closeEdit();render();renderManager();toast('Configuração restaurada.');}catch(err){toast(err.message,true);} });
  document.addEventListener('keydown',e=>{if(e.key==='Escape')closeManager();});
  loadApps();
})();
