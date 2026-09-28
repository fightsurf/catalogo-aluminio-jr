(() => {
  const $ = id => document.getElementById(id);
  const state = { apps: [], categories: [], selectedCategory: null, query: '', managerQuery: '', draggingRoute: null };
  const ICONS = ['folder','folders','shopping-bag','shopping-cart','factory','truck','route','circle-dollar-sign','wallet','megaphone','message-circle','database','package','package-search','chart-column','chart-no-axes-combined','clipboard-list','users','settings','wrench','warehouse','calendar','file-text','inbox','send','video','image','store','smartphone','network','boxes','contact','tags'];
  const icon = name => `<i data-lucide="${name || 'folder'}"></i>`;
  const esc = v => String(v ?? '').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const norm = v => String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const refreshIcons = () => window.lucide && window.lucide.createIcons();
  const categoryByName = name => state.categories.find(c => c.nome === name);

  function toast(msg, bad=false){ const el=$('toast'); el.textContent=msg; el.className=`toast ${bad?'bad':''}`; el.hidden=false; clearTimeout(toast.t); toast.t=setTimeout(()=>el.hidden=true,3000); }
  function visibleApps(){ return state.apps.filter(a=>a.visibilidade!=='oculto'); }
  function matches(app,q){ if(!q)return true; const h=norm(`${app.nome} ${app.categoria} ${app.descricao} ${app.rota}`); return h.includes(norm(q)); }
  function categoryIcon(name){ return categoryByName(name)?.icone || 'folder'; }
  function orderedCategoryNames(includeEmpty=true){
    const details=state.categories.filter(c=>includeEmpty || c.quantidade>0);
    return details.map(c=>c.nome);
  }
  function fillIconSelect(select, value='folder'){
    select.innerHTML=ICONS.map(i=>`<option value="${i}" ${i===value?'selected':''}>${i}</option>`).join('');
  }

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
    const apps=visibleApps().filter(a=>a.categoria===category.nome);
    const el=document.createElement('button'); el.className='category-card';
    el.innerHTML=`<span class="category-icon">${icon(category.icone||'folder')}</span><span><strong>${esc(category.nome)}</strong><small>${apps.length} aplicativo${apps.length===1?'':'s'}</small></span><span class="chev">${icon('chevron-right')}</span>`;
    el.addEventListener('click',()=>selectCategory(category.nome)); return el;
  }

  function renderHome(){
    if(state.query.trim()){ renderSearch(); return; }
    $('categoriesSection').hidden=false; $('appsSection').hidden=true;
    const cats=state.categories.filter(c=>visibleApps().some(a=>a.categoria===c.nome));
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
    const categories=orderedCategoryNames(true);
    $('categoryOptions').innerHTML=categories.map(c=>`<option value="${esc(c)}"></option>`).join('');
    categories.forEach(category=>{
      const apps=state.apps.filter(a=>a.categoria===category&&matches(a,state.managerQuery));
      const lane=document.createElement('section'); lane.className='manager-lane'; lane.dataset.category=category;
      lane.innerHTML=`<div class="lane-head"><strong>${esc(category)}</strong><span>${apps.length}</span></div><div class="lane-drop"></div>`;
      const drop=lane.querySelector('.lane-drop'); apps.forEach(a=>drop.appendChild(appCard(a,true)));
      ['dragenter','dragover'].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault(); drop.classList.add('drop-active');}));
      drop.addEventListener('dragleave',e=>{ if(!drop.contains(e.relatedTarget)) drop.classList.remove('drop-active'); });
      drop.addEventListener('drop',async e=>{ e.preventDefault(); drop.classList.remove('drop-active'); const route=e.dataTransfer.getData('text/plain')||state.draggingRoute; const app=state.apps.find(a=>a.rota===route); if(app&&app.categoria!==category){ const old=app.categoria; app.categoria=category; renderManager(); try{await saveApp(app); await loadApps(false); toast(`Movido de ${old} para ${category}.`);}catch(err){app.categoria=old;renderManager();toast(err.message,true);} } });
      board.appendChild(lane);
    }); refreshIcons();
  }

  function renderCategoriesManager(){
    const list=$('categoriesList'); list.innerHTML='';
    state.categories.forEach((cat,index)=>{
      const row=document.createElement('div'); row.className='category-manage-row';
      row.innerHTML=`<span class="category-manage-icon">${icon(cat.icone||'folder')}</span><span class="category-manage-copy"><strong>${esc(cat.nome)}</strong><small>${cat.quantidade} aplicativo${cat.quantidade===1?'':'s'}</small></span><div class="category-order-actions"><button type="button" class="mini-btn up" title="Subir" ${index===0?'disabled':''}>${icon('chevron-up')}</button><button type="button" class="mini-btn down" title="Descer" ${index===state.categories.length-1?'disabled':''}>${icon('chevron-down')}</button><button type="button" class="mini-btn edit" title="Editar">${icon('pencil')}</button></div>`;
      row.querySelector('.edit').addEventListener('click',()=>openCategoryEdit(cat));
      row.querySelector('.up').addEventListener('click',()=>moveCategory(index,-1));
      row.querySelector('.down').addEventListener('click',()=>moveCategory(index,1));
      list.appendChild(row);
    }); refreshIcons();
  }

  async function moveCategory(index,delta){
    const target=index+delta; if(target<0||target>=state.categories.length)return;
    const original=[...state.categories]; [state.categories[index],state.categories[target]]=[state.categories[target],state.categories[index]]; renderCategoriesManager(); renderHome();
    try{
      const r=await fetch('/sistema/api/categorias-ordem',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({nomes:state.categories.map(c=>c.nome)})});
      const data=await r.json().catch(()=>({})); if(!r.ok)throw new Error(data.erro||'Erro ao ordenar categorias.'); state.categories=data.categorias||state.categories; renderCategoriesManager(); render(); if($('manager').classList.contains('open'))renderManager();
    }catch(err){state.categories=original;renderCategoriesManager();render();toast(err.message,true);}
  }

  async function saveApp(app){
    const r=await fetch('/sistema/api/apps/config',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({rota:app.rota,nome:app.nome,categoria:app.categoria,visibilidade:app.visibilidade,favorito:app.favorito,ordem:app.ordem})});
    const data=await r.json().catch(()=>({})); if(!r.ok) throw new Error(data.erro||'Erro ao salvar configuração.');
    const i=state.apps.findIndex(a=>a.rota===app.rota); if(i>=0) state.apps[i]=data.app; return data.app;
  }
  function openEdit(app){ $('editRota').value=app.rota; $('editRoute').textContent=app.rota; $('editNome').value=app.nome; $('editCategoria').value=app.categoria; $('editVisibilidade').value=app.visibilidade||'principal'; $('editFavorito').checked=!!app.favorito; $('editDialog').showModal(); refreshIcons(); }
  function closeEdit(){ $('editDialog').close(); }

  function openCategories(){ fillIconSelect($('newCategoryIcon'),'folder'); renderCategoriesManager(); $('categoriesDialog').showModal(); refreshIcons(); }
  function closeCategories(){ $('categoriesDialog').close(); }
  function openCategoryEdit(cat){ $('categoryOriginalName').value=cat.nome; $('categoryEditOriginal').textContent=cat.quantidade?`${cat.quantidade} aplicativo(s) nesta categoria`:'Categoria vazia'; $('categoryEditName').value=cat.nome; fillIconSelect($('categoryEditIcon'),cat.icone||'folder'); $('deleteCategoryButton').disabled=cat.quantidade>0; $('deleteCategoryButton').title=cat.quantidade>0?'Mova os aplicativos antes de excluir.':'Excluir categoria'; $('categoryEditDialog').showModal(); refreshIcons(); }
  function closeCategoryEdit(){ $('categoryEditDialog').close(); }

  async function loadApps(showSpinner=true){
    if(showSpinner)$('refreshButton').classList.add('loading');
    try{ const r=await fetch('/sistema/api/apps',{cache:'no-store'}); if(!r.ok) throw new Error(`HTTP ${r.status}`); const data=await r.json(); state.apps=data.apps||[]; state.categories=data.categoriasDetalhes||[]; $('summaryText').textContent=`${data.visiveis ?? data.total} aplicativos visíveis em ${state.categories.length} categorias. A organização fica salva no servidor.`; if(state.selectedCategory && !state.categories.some(c=>c.nome===state.selectedCategory))state.selectedCategory=null; render(); if($('manager').classList.contains('open'))renderManager(); if($('categoriesDialog').open)renderCategoriesManager(); }
    catch(err){console.error(err);$('summaryText').textContent='Não foi possível carregar o catálogo.';toast('Erro ao carregar aplicativos.',true);} finally{if(showSpinner)$('refreshButton').classList.remove('loading');refreshIcons();}
  }

  $('searchInput').addEventListener('input',e=>{state.query=e.target.value;state.selectedCategory=null;render();});
  $('backButton').addEventListener('click',()=>{state.selectedCategory=null;state.query='';$('searchInput').value='';renderHome();});
  $('refreshButton').addEventListener('click',()=>loadApps(true));
  $('manageButton').addEventListener('click',()=>{$('manager').classList.add('open');$('scrim').classList.add('open');$('manager').setAttribute('aria-hidden','false');renderManager();});
  $('categoriesButton').addEventListener('click',openCategories);
  function closeManager(){$('manager').classList.remove('open');$('scrim').classList.remove('open');$('manager').setAttribute('aria-hidden','true');}
  $('closeManager').addEventListener('click',closeManager); $('scrim').addEventListener('click',closeManager);
  $('managerSearch').addEventListener('input',e=>{state.managerQuery=e.target.value;renderManager();});
  $('closeEdit').addEventListener('click',closeEdit); $('cancelEdit').addEventListener('click',closeEdit);
  $('closeCategories').addEventListener('click',closeCategories);
  $('closeCategoryEdit').addEventListener('click',closeCategoryEdit); $('cancelCategoryEdit').addEventListener('click',closeCategoryEdit);

  $('newCategoryForm').addEventListener('submit',async e=>{
    e.preventDefault(); const nome=$('newCategoryName').value.trim(), icone=$('newCategoryIcon').value;
    try{const r=await fetch('/sistema/api/categorias',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({nome,icone})});const data=await r.json().catch(()=>({}));if(!r.ok)throw new Error(data.erro||'Erro ao criar categoria.');$('newCategoryName').value='';await loadApps(false);toast('Categoria criada para todos os dispositivos.');}catch(err){toast(err.message,true);}
  });

  $('categoryEditForm').addEventListener('submit',async e=>{
    e.preventDefault(); const original=$('categoryOriginalName').value, nome=$('categoryEditName').value.trim(), icone=$('categoryEditIcon').value;
    try{const r=await fetch(`/sistema/api/categorias/${encodeURIComponent(original)}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({nome,icone})});const data=await r.json().catch(()=>({}));if(!r.ok)throw new Error(data.erro||'Erro ao salvar categoria.');closeCategoryEdit();await loadApps(false);toast(original===nome?'Categoria atualizada.':`Categoria renomeada para ${nome}.`);}catch(err){toast(err.message,true);}
  });

  $('deleteCategoryButton').addEventListener('click',async()=>{
    const nome=$('categoryOriginalName').value; const cat=categoryByName(nome); if(cat?.quantidade){toast('Mova os aplicativos desta categoria antes de excluí-la.',true);return;} if(!confirm(`Excluir a categoria “${nome}”?`))return;
    try{const r=await fetch(`/sistema/api/categorias/${encodeURIComponent(nome)}`,{method:'DELETE'});const data=await r.json().catch(()=>({}));if(!r.ok)throw new Error(data.erro||'Erro ao excluir categoria.');closeCategoryEdit();await loadApps(false);toast('Categoria excluída.');}catch(err){toast(err.message,true);}
  });

  $('editForm').addEventListener('submit',async e=>{e.preventDefault(); const app=state.apps.find(a=>a.rota===$('editRota').value); if(!app)return; const original={...app}; app.nome=$('editNome').value.trim(); app.categoria=$('editCategoria').value.trim(); app.visibilidade=$('editVisibilidade').value; app.favorito=$('editFavorito').checked; try{await saveApp(app);closeEdit();await loadApps(false);toast('Alterações salvas para todos os dispositivos.');}catch(err){Object.assign(app,original);toast(err.message,true);} });
  $('resetButton').addEventListener('click',async()=>{ const rota=$('editRota').value; if(!confirm('Restaurar nome, categoria e visibilidade automáticos deste aplicativo?'))return; try{const r=await fetch('/sistema/api/apps/config',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({rota})});const data=await r.json();if(!r.ok)throw new Error(data.erro||'Erro ao restaurar.');closeEdit();await loadApps(false);toast('Configuração restaurada.');}catch(err){toast(err.message,true);} });
  document.addEventListener('keydown',e=>{if(e.key==='Escape')closeManager();});
  fillIconSelect($('newCategoryIcon'),'folder');
  fillIconSelect($('categoryEditIcon'),'folder');
  loadApps();
})();
