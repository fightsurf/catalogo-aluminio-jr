(() => {
  'use strict';
  const actions = document.querySelector('.top-actions');
  const panel = document.getElementById('ag-status-panel');
  if (!actions || !panel) return;

  const openButton = document.createElement('button');
  openButton.type = 'button';
  openButton.className = 'btn btn-outline';
  openButton.textContent = 'Agendamentos de Publicações';
  actions.prepend(openButton);

  const overlay = document.createElement('div');
  overlay.className = 'ag-overlay';
  overlay.hidden = true;
  overlay.innerHTML = `
    <section class="ag-modal" role="dialog" aria-modal="true" aria-labelledby="ag-modal-title" aria-describedby="ag-modal-subtitle">
      <header class="ag-modal-header">
        <div>
          <h2 class="ag-modal-title" id="ag-modal-title">Agendamentos de Publicações</h2>
          <p class="ag-modal-subtitle" id="ag-modal-subtitle">Publique categorias automaticamente, em sequência, sem manter esta página aberta.</p>
        </div>
        <button id="ag-close" type="button" class="btn btn-outline ag-close" aria-label="Fechar configurações">Fechar</button>
      </header>
      <div class="ag-modal-body">
        <form id="ag-form">
          <label class="ag-switch" for="ag-active">
            <input id="ag-active" type="checkbox" />
            <span>Ativar agendamento<small>Se houver publicação incerta, o sistema pausará para revisão.</small></span>
          </label>
          <div class="ag-form-grid">
            <div class="ag-field">
              <label for="ag-interval">Intervalo (minutos)</label>
              <input id="ag-interval" type="number" min="1" max="10080" step="1" required />
              <small class="ag-hint">Ex.: 90 = 1h30; 165 = 2h45</small>
            </div>
            <div class="ag-field">
              <label for="ag-start">Início das publicações</label>
              <input id="ag-start" type="time" required />
            </div>
            <div class="ag-field">
              <label for="ag-end">Fim das publicações</label>
              <input id="ag-end" type="time" required />
            </div>
            <div class="ag-field">
              <label for="ag-media">Conteúdo</label>
              <select id="ag-media">
                <option value="foto">Apenas fotos</option>
                <option value="video">Apenas vídeos</option>
                <option value="foto_video">Fotos e vídeos</option>
              </select>
            </div>
          </div>
          <div class="ag-section-header">
            <h3>Categorias na sequência</h3>
            <p>Marque e use as setas para definir a ordem.</p>
          </div>
          <div id="ag-cats" class="ag-category-list" aria-label="Lista de categorias"></div>
          <div class="ag-form-footer">
            <button id="ag-save" type="submit" class="btn btn-primary">Salvar agendamento</button>
            <p id="ag-state" class="ag-feedback" role="status" aria-live="polite"></p>
          </div>
        </form>
        <div class="ag-modal-history">
          <h3>Últimas execuções</h3>
          <div id="ag-history" class="ag-history-list"></div>
        </div>
      </div>
    </section>`;
  document.body.append(overlay);

  const modalEl = id => overlay.querySelector('#' + id);
  const $ = id => document.getElementById(id);
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
  const dateFormat = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
  const timeFormat = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit'
  });

  let categories = [];
  let lastData = null;
  let nextTime = null;
  let showingModal = false;
  let pendingRefresh = null;
  let triggerElement = null;

  async function json(url, options) {
    const response = await fetch(url, { credentials: 'same-origin', ...options });
    const body = await response.json();
    if (!response.ok || body.success === false) {
      throw new Error(body.error || body.message || `Erro ao consultar o servidor (${response.status}).`);
    }
    return body.data;
  }

  const categoryName = id => categories.find(category => category.id === Number(id))?.nome || `Categoria nº ${id}`;

  function showBadge(text, style) {
    const badge = $('ag-status-badge');
    badge.className = `ag-status-badge ${style}`;
    badge.textContent = text;
  }

  function updateCountdown() {
    const countdown = $('ag-status-countdown');
    if (!nextTime || !lastData?.config?.ativo) return;
    const seconds = Math.max(0, Math.ceil((nextTime.getTime() - Date.now()) / 1000));
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const rest = seconds % 60;
    countdown.textContent = days
      ? `${days}d ${String(hours).padStart(2, '0')}h ${String(minutes).padStart(2, '0')}min`
      : `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
    if (seconds === 0) countdown.textContent = 'Aguardando execução';
  }

  function renderPanel() {
    const cfg = lastData?.config;
    const latest = lastData?.historico?.[0];
    const issue = $('ag-status-warning');
    issue.hidden = true;
    nextTime = null;
    $('ag-next-label').textContent = 'Próxima categoria';
    $('ag-next-category').textContent = '—';
    $('ag-status-countdown').textContent = '—';
    $('ag-status-date').textContent = '—';
    if (!cfg) {
      showBadge('Indisponível', 'ag-error');
      issue.textContent = 'Não foi possível consultar o agendamento. As publicações manuais permanecem disponíveis.';
      issue.hidden = false;
      return;
    }

    const running = cfg.ativo && !cfg.proxima_execucao && latest?.estado === 'executando';
    const pausedForReview = !cfg.ativo && latest?.estado === 'revisao';
    if (running) {
      showBadge('Publicando agora', 'ag-working');
      $('ag-next-label').textContent = 'Categoria em publicação';
      $('ag-next-category').textContent = latest.categoria_nome || categoryName(latest.categoria_id);
      $('ag-status-countdown').textContent = 'Em andamento';
      $('ag-status-date').textContent = latest.iniciado_em ? dateFormat.format(new Date(latest.iniciado_em)) : '—';
      return;
    }
    if (pausedForReview) {
      showBadge('Pausado para revisão', 'ag-warning');
      $('ag-next-category').textContent = 'A definir após revisão';
      issue.textContent = 'A última publicação precisa ser conferida antes de reativar o agendamento.';
      issue.hidden = false;
      return;
    }
    if (!cfg.ativo) {
      showBadge('Desativado', '');
      $('ag-next-category').textContent = cfg.categorias?.length ? categoryName(cfg.categorias[Number(cfg.indice || 0) % cfg.categorias.length]) : 'Nenhuma categoria selecionada';
      $('ag-status-countdown').textContent = 'Não agendado';
      return;
    }

    showBadge('Ativo', 'ag-active');
    const ids = Array.isArray(cfg.categorias) ? cfg.categorias : [];
    $('ag-next-category').textContent = ids.length
      ? categoryName(ids[Number(cfg.indice || 0) % ids.length]) : 'Nenhuma categoria selecionada';
    if (cfg.proxima_execucao) {
      const upcoming = new Date(cfg.proxima_execucao);
      if (Number.isFinite(upcoming.getTime())) {
        nextTime = upcoming;
        $('ag-status-date').textContent = dateFormat.format(upcoming);
        updateCountdown();
      }
    } else {
      $('ag-status-countdown').textContent = 'Aguardando servidor';
    }
  }

  async function refreshPanel() {
    if (pendingRefresh) return pendingRefresh;
    pendingRefresh = (async () => {
      try {
        lastData = await json('/api/whatsapp/status/agendamentos');
        renderPanel();
      } catch (error) {
        lastData = null;
        renderPanel();
        $('ag-status-warning').textContent = `Falha de conexão: ${error.message}`;
      }
    })();
    try { await pendingRefresh; } finally { pendingRefresh = null; }
  }

  async function loadCategories() {
    const data = await json('/api/whatsapp/status/categorias');
    const list = Array.isArray(data) ? data : data?.data || [];
    categories = list.map(c => ({ id: Number(c.id), nome: String(c.nome || ''), selected: false }));
    if (lastData) renderPanel();
  }

  function renderCategories() {
    const container = modalEl('ag-cats');
    container.innerHTML = categories.length ? categories.map((c, index) => `
      <div class="ag-category-row">
        <input type="checkbox" id="ag-category-${c.id}" data-id="${c.id}" ${c.selected ? 'checked' : ''} aria-label="Selecionar ${escapeHtml(c.nome)}" />
        <label class="ag-category-name" for="ag-category-${c.id}">${escapeHtml(c.nome)}</label>
        <button type="button" class="btn btn-outline ag-order-btn" data-up="${index}" title="Mover para cima" aria-label="Mover ${escapeHtml(c.nome)} para cima" ${index === 0 ? 'disabled' : ''}>↑</button>
        <button type="button" class="btn btn-outline ag-order-btn" data-down="${index}" title="Mover para baixo" aria-label="Mover ${escapeHtml(c.nome)} para baixo" ${index === categories.length - 1 ? 'disabled' : ''}>↓</button>
      </div>`).join('') : '<div class="ag-empty">Nenhuma categoria disponível.</div>';
  }

  function renderHistory(history) {
    const container = modalEl('ag-history');
    container.innerHTML = Array.isArray(history) && history.length
      ? history.map(item => {
        const when = item.iniciado_em ? dateFormat.format(new Date(item.iniciado_em)) : '—';
        const state = item.estado === 'concluido' ? 'Concluída'
          : item.estado === 'executando' ? 'Em andamento'
            : item.estado === 'revisao' ? 'Requer revisão' : String(item.estado || '—');
        return `<div class="ag-history-row">
          <strong>${escapeHtml(item.categoria_nome)}</strong> — <span class="${item.estado === 'revisao' ? 'ag-history-failed' : 'ag-history-muted'}">${escapeHtml(state)}</span>
          <div class="ag-history-muted">${escapeHtml(when)} · ${escapeHtml(item.tipo_midia || '')}</div>
          ${item.erro ? `<div class="ag-history-failed">${escapeHtml(item.erro)}</div>` : ''}
        </div>`;
      }).join('')
      : '<div class="ag-empty">Nenhuma execução registrada até o momento.</div>';
  }

  function message(text, isError = false) {
    const elem = modalEl('ag-state');
    elem.textContent = text;
    elem.classList.toggle('ag-feedback-error', Boolean(isError));
  }

  async function loadModal() {
    message('Carregando configurações…');
    modalEl('ag-save').disabled = true;
    try {
      const [data, catData] = await Promise.all([
        json('/api/whatsapp/status/agendamentos'),
        json('/api/whatsapp/status/categorias')
      ]);
      lastData = data;
      const cfg = data.config;
      const ordered = Array.isArray(cfg.categorias) ? cfg.categorias.map(Number) : [];
      const raw = Array.isArray(catData) ? catData : catData?.data || [];
      categories = raw.map(c => ({
        id: Number(c.id), nome: String(c.nome || ''),
        selected: ordered.includes(Number(c.id))
      }));
      categories.sort((a, b) => {
        const i = ordered.indexOf(a.id), j = ordered.indexOf(b.id);
        return (i === -1 ? Infinity : i) - (j === -1 ? Infinity : j);
      });
      renderCategories();
      modalEl('ag-active').checked = Boolean(cfg.ativo);
      modalEl('ag-interval').value = String(cfg.intervalo_minutos ?? 90);
      modalEl('ag-start').value = cfg.inicio || '06:00';
      modalEl('ag-end').value = cfg.fim || '22:00';
      modalEl('ag-media').value = cfg.tipo_midia || 'foto';
      renderHistory(data.historico);
      renderPanel();
      message(cfg.ativo ? `Ativo · Próxima execução: ${cfg.proxima_execucao ? dateFormat.format(new Date(cfg.proxima_execucao)) : 'em andamento'}` : 'Agendamento desativado.');
    } catch (error) {
      message(error.message, true);
      modalEl('ag-cats').innerHTML = '<div class="ag-empty">Não foi possível carregar as categorias.</div>';
      modalEl('ag-history').innerHTML = '<div class="ag-empty">Histórico indisponível.</div>';
    } finally {
      modalEl('ag-save').disabled = false;
    }
  }

  function closeModal() {
    if (!showingModal) return;
    showingModal = false;
    overlay.hidden = true;
    document.body.classList.remove('ag-modal-open');
    if (triggerElement && typeof triggerElement.focus === 'function') triggerElement.focus();
  }
  function openModal() {
    triggerElement = document.activeElement;
    overlay.hidden = false;
    showingModal = true;
    document.body.classList.add('ag-modal-open');
    modalEl('ag-close').focus();
    loadModal();
  }

  openButton.addEventListener('click', openModal);
  modalEl('ag-close').addEventListener('click', closeModal);
  overlay.addEventListener('click', event => { if (event.target === overlay) closeModal(); });
  document.addEventListener('keydown', event => {
    if (!showingModal) return;
    if (event.key === 'Escape') { event.preventDefault(); closeModal(); }
    if (event.key === 'Tab') {
      const focusables = [...overlay.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled)')].filter(el => el.getClientRects().length);
      if (!focusables.length) return;
      const first = focusables[0], last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });
  modalEl('ag-cats').addEventListener('click', event => {
    const control = event.target.closest('button[data-up],button[data-down]');
    if (!control) return;
    const isUp = control.hasAttribute('data-up');
    const index = Number(control.dataset[isUp ? 'up' : 'down']);
    const other = index + (isUp ? -1 : 1);
    if (other < 0 || other >= categories.length) return;
    [categories[index], categories[other]] = [categories[other], categories[index]];
    renderCategories();
    const selector = `[data-${isUp ? 'up' : 'down'}="${other}"]`;
    modalEl('ag-cats').querySelector(selector)?.focus();
  });
  modalEl('ag-cats').addEventListener('change', event => {
    if (!event.target.matches('input[type="checkbox"][data-id]')) return;
    const category = categories.find(c => c.id === Number(event.target.dataset.id));
    if (category) category.selected = event.target.checked;
  });
  modalEl('ag-form').addEventListener('submit', async event => {
    event.preventDefault();
    const body = {
      ativo: modalEl('ag-active').checked,
      intervalo_minutos: Number(modalEl('ag-interval').value),
      inicio: modalEl('ag-start').value,
      fim: modalEl('ag-end').value,
      tipo_midia: modalEl('ag-media').value,
      categorias: categories.filter(c => c.selected).map(c => c.id)
    };
    if (body.ativo && !body.categorias.length) {
      message('Selecione ao menos uma categoria para ativar o agendamento.', true);
      return;
    }
    const save = modalEl('ag-save');
    save.disabled = true;
    message('Salvando configurações…');
    try {
      await json('/api/whatsapp/status/agendamentos', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      });
      await loadModal();
      message('Configurações salvas. ' + (body.ativo ? 'Agendamento ativo.' : 'Agendamento desativado.'));
    } catch (error) {
      message(error.message, true);
    } finally {
      save.disabled = false;
    }
  });

  // Nunca depende do modal estar aberto. Mantém o mostrador atualizado.
  refreshPanel();
  loadCategories().catch(error => console.warn('[Agendamentos] Categorias indisponíveis:', error.message));
  setInterval(updateCountdown, 1000);
  setInterval(refreshPanel, 30000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) { updateCountdown(); refreshPanel(); }
  });
})();
