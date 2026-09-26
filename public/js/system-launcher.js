(() => {
  const state = { apps: [], filtered: [], category: 'Todos', query: '' };
  const favoritesKey = 'ajr-system-favorites-v1';
  const recentsKey = 'ajr-system-recents-v1';
  const seenKey = 'ajr-system-seen-routes-v1';
  const $ = id => document.getElementById(id);

  const readJson = (key, fallback) => {
    try { return JSON.parse(localStorage.getItem(key) || '') || fallback; } catch (_) { return fallback; }
  };
  const writeJson = (key, value) => localStorage.setItem(key, JSON.stringify(value));
  const getFavorites = () => new Set(readJson(favoritesKey, []));
  const getRecents = () => readJson(recentsKey, []);
  const getSeen = () => new Set(readJson(seenKey, []));
  const normalize = text => String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

  function icon(name) { return `<i data-lucide="${name || 'app-window'}"></i>`; }
  function refreshIcons() { if (window.lucide) window.lucide.createIcons(); }

  function markRecent(route) {
    const next = [route, ...getRecents().filter(item => item !== route)].slice(0, 8);
    writeJson(recentsKey, next);
  }

  function toggleFavorite(route, event) {
    event.preventDefault(); event.stopPropagation();
    const favorites = getFavorites();
    favorites.has(route) ? favorites.delete(route) : favorites.add(route);
    writeJson(favoritesKey, [...favorites]);
    renderAll();
  }

  function appCard(app, compact = false) {
    const favorites = getFavorites();
    const seen = getSeen();
    const isNew = !seen.has(app.rota);
    const link = document.createElement('a');
    link.className = 'app-card';
    link.href = app.rota;
    link.title = `${app.nome} — ${app.rota}`;
    link.innerHTML = `${isNew ? '<span class="new-dot" title="Novo aplicativo detectado"></span>' : ''}
      <span class="app-icon">${icon(app.icone)}</span>
      <span class="app-copy"><div class="app-name">${escapeHtml(app.nome)}</div>${compact ? '' : `<div class="app-desc">${escapeHtml(app.descricao)}</div>`}</span>
      <button class="favorite-button ${favorites.has(app.rota) ? 'on' : ''}" title="${favorites.has(app.rota) ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}">${icon('star')}</button>`;
    link.addEventListener('click', () => markRecent(app.rota));
    link.querySelector('.favorite-button').addEventListener('click', event => toggleFavorite(app.rota, event));
    return link;
  }

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  }

  function applyFilter() {
    const q = normalize(state.query);
    state.filtered = state.apps.filter(app => {
      const inCategory = state.category === 'Todos' || app.categoria === state.category;
      const haystack = normalize(`${app.nome} ${app.categoria} ${app.descricao} ${app.rota}`);
      return inCategory && (!q || haystack.includes(q));
    });
  }

  function renderCategories() {
    const categories = ['Todos', ...new Set(state.apps.map(app => app.categoria))];
    const targets = [[$('categoryChips'), false], [$('startCategories'), true]];
    targets.forEach(([container]) => {
      container.innerHTML = '';
      categories.forEach(category => {
        const button = document.createElement('button');
        button.className = `chip ${state.category === category ? 'active' : ''}`;
        button.textContent = category;
        button.addEventListener('click', () => { state.category = category; renderAll(); });
        container.appendChild(button);
      });
    });
  }

  function renderApps() {
    applyFilter();
    const grid = $('appsGrid'); grid.innerHTML = '';
    state.filtered.forEach(app => grid.appendChild(appCard(app)));
    $('emptyState').hidden = state.filtered.length > 0;
    $('filterLabel').textContent = state.category === 'Todos' ? `${state.filtered.length} aplicativos` : state.category;
  }

  function renderFavorites() {
    const favorites = getFavorites();
    const apps = state.apps.filter(app => favorites.has(app.rota));
    $('favoritesSection').hidden = apps.length === 0;
    $('favoritesGrid').innerHTML = '';
    apps.forEach(app => $('favoritesGrid').appendChild(appCard(app)));
  }

  function renderRecents() {
    const routes = getRecents();
    const apps = routes.map(route => state.apps.find(app => app.rota === route)).filter(Boolean).slice(0, 6);
    $('recentsSection').hidden = apps.length === 0;
    $('recentsGrid').innerHTML = '';
    apps.forEach(app => $('recentsGrid').appendChild(appCard(app, true)));
  }

  function renderStartResults() {
    applyFilter();
    const list = $('startResults'); list.innerHTML = '';
    state.filtered.slice(0, 30).forEach(app => {
      const link = document.createElement('a'); link.className = 'start-item'; link.href = app.rota;
      link.innerHTML = `<span class="app-icon">${icon(app.icone)}</span><span><strong>${escapeHtml(app.nome)}</strong><span>${escapeHtml(app.categoria)}</span></span>`;
      link.addEventListener('click', () => markRecent(app.rota));
      list.appendChild(link);
    });
  }

  function renderAll() {
    renderCategories(); renderApps(); renderFavorites(); renderRecents(); renderStartResults(); refreshIcons();
  }

  async function loadApps() {
    $('refreshButton').classList.add('loading');
    try {
      const response = await fetch('/sistema/api/apps', { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      state.apps = data.apps || [];
      $('summaryText').textContent = `${data.total || 0} aplicativos em ${(data.categorias || []).length} áreas. O catálogo é montado a partir das telas existentes no projeto.`;
      renderAll();
      writeJson(seenKey, state.apps.map(app => app.rota));
    } catch (err) {
      console.error(err);
      $('summaryText').textContent = 'Não foi possível carregar o catálogo de aplicativos.';
    } finally {
      $('refreshButton').classList.remove('loading');
    }
  }

  function setQuery(value) {
    state.query = value;
    $('desktopSearch').value = value;
    $('startSearch').value = value;
    renderAll();
  }

  function openStart() {
    $('startMenu').classList.add('open'); $('scrim').classList.add('open'); $('startMenu').setAttribute('aria-hidden','false'); $('startButton').setAttribute('aria-expanded','true');
    setTimeout(() => $('startSearch').focus(), 60);
  }
  function closeStart() {
    $('startMenu').classList.remove('open'); $('scrim').classList.remove('open'); $('startMenu').setAttribute('aria-hidden','true'); $('startButton').setAttribute('aria-expanded','false');
  }

  $('desktopSearch').addEventListener('input', e => setQuery(e.target.value));
  $('startSearch').addEventListener('input', e => setQuery(e.target.value));
  $('startButton').addEventListener('click', () => $('startMenu').classList.contains('open') ? closeStart() : openStart());
  $('taskSearchButton').addEventListener('click', openStart);
  $('closeStart').addEventListener('click', closeStart);
  $('scrim').addEventListener('click', closeStart);
  $('refreshButton').addEventListener('click', loadApps);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeStart(); });

  function updateClock() {
    const now = new Date();
    $('clock').innerHTML = `${now.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}<br>${now.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric'})}`;
  }
  updateClock(); setInterval(updateClock, 30000);
  loadApps();
})();
