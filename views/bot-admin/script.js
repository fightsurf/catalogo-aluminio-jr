(() => {
  const API = '/bot/admin';
  const INTENCAO_DESCONHECIDO = 'DESCONHECIDO';

  let paginaConversas = 1;
  let totalPaginasConversas = 1;
  let telefoneAtivo = null;
  let paginaMensagens = 1;
  let totalMensagens = 0;
  const LIMIT_MENSAGENS = 50;

  // ── WebSocket / Fallback ─────────────────────────────────────

  const WS_URL = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/bot-admin`;
  const BACKOFF = [2000, 5000, 10000];
  let wsAttempt = 0;
  let wsConnected = false;
  let fallbackTimer = null;
  let wsInstance = null;

  function iniciarFallback() {
    if (fallbackTimer) return;
    fallbackTimer = setInterval(() => {
      atualizarListaSilenciosa();
    }, 15000);
  }

  function pararFallback() {
    if (fallbackTimer) {
      clearInterval(fallbackTimer);
      fallbackTimer = null;
    }
  }

  function conectarWs() {
    if (wsInstance) {
      try { wsInstance.close(); } catch (_) {}
    }

    const ws = new WebSocket(WS_URL);
    wsInstance = ws;

    ws.onopen = () => {
      wsConnected = true;
      wsAttempt = 0;
      pararFallback();
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.tipo === 'nova_mensagem') {
          atualizarListaSilenciosa();
          if (telefoneAtivo && data.telefone === telefoneAtivo) {
            recarregarMensagensAtivas();
          }
        }
      } catch (_) {}
    };

    ws.onclose = () => {
      wsConnected = false;
      wsInstance = null;
      iniciarFallback();
      const delay = BACKOFF[Math.min(wsAttempt, BACKOFF.length - 1)];
      wsAttempt++;
      setTimeout(conectarWs, delay);
    };

    ws.onerror = () => {
      ws.close();
    };
  }

  // Atualizar lista sem "piscar" (sem mostrar spinner)
  async function atualizarListaSilenciosa() {
    const filtros = getFiltros();
    const qs = buildQuery({ ...filtros, page: paginaConversas, limit: 20 });
    try {
      const res = await fetch(`${API}/conversas?${qs}`);
      if (!res.ok) return;
      const data = await res.json();
      totalPaginasConversas = data.total_paginas || 1;
      renderConversas(data.dados || []);
      renderPaginacaoConversas(data.pagina, data.total_paginas, data.total);
    } catch (_) {}
  }

  // Recarregar mensagens da conversa ativa preservando scroll inteligente
  async function recarregarMensagensAtivas() {
    if (!telefoneAtivo) return;
    const container = document.getElementById('chat-mensagens');
    const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 120;

    try {
      const qs = buildQuery({ page: paginaMensagens, limit: LIMIT_MENSAGENS });
      const res = await fetch(`${API}/mensagens/${encodeURIComponent(telefoneAtivo)}?${qs}`);
      if (!res.ok) return;
      const data = await res.json();
      totalMensagens = data.total || 0;
      renderMensagensSilencioso(data.dados || [], nearBottom);
      renderPaginacaoMensagens(telefoneAtivo, paginaMensagens, totalMensagens);
    } catch (_) {}
  }

  function renderMensagensSilencioso(mensagens, autoScroll) {
    const container = document.getElementById('chat-mensagens');
    if (!mensagens.length) return;
    container.innerHTML = mensagens.map(m => buildBolhaHtml(m)).join('');
    if (autoScroll) {
      container.scrollTop = container.scrollHeight;
    }
  }

  // ── Helpers ────────────────────────────────────────────────

  function formatarData(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  }

  function esc(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function getFiltros() {
    return {
      telefone: document.getElementById('filtro-telefone').value.trim(),
      data_inicio: document.getElementById('filtro-data-inicio').value,
      data_fim: document.getElementById('filtro-data-fim').value,
      nivel_atendimento: document.getElementById('filtro-nivel').value
    };
  }

  function buildQuery(params) {
    return Object.entries(params)
      .filter(([, v]) => v !== '' && v != null)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');
  }

  // ── Lista de Conversas ──────────────────────────────────────

  async function carregarConversas(pagina = 1) {
    paginaConversas = pagina;
    const filtros = getFiltros();
    const qs = buildQuery({ ...filtros, page: pagina, limit: 20 });

    const lista = document.getElementById('lista-conversas');
    lista.innerHTML = '<p class="msg-carregando">Carregando...</p>';

    try {
      const res = await fetch(`${API}/conversas?${qs}`);
      if (!res.ok) throw new Error('Erro ao carregar conversas');
      const data = await res.json();

      totalPaginasConversas = data.total_paginas || 1;
      renderConversas(data.dados || []);
      renderPaginacaoConversas(data.pagina, data.total_paginas, data.total);
    } catch (err) {
      lista.innerHTML = `<p class="msg-vazia">Erro: ${err.message}</p>`;
    }
  }

  function renderConversas(conversas) {
    const lista = document.getElementById('lista-conversas');
    if (!conversas.length) {
      lista.innerHTML = '<p class="msg-vazia">Nenhuma conversa encontrada.</p>';
      return;
    }

    lista.innerHTML = conversas.map(c => {
      const nivel = c.nivel_atendimento || 'HUMANO';
      const ativa = c.telefone === telefoneAtivo ? ' ativa' : '';
      return `
        <div class="conversa-item${ativa}" data-telefone="${c.telefone}">
          <span class="conversa-telefone">${c.telefone}</span>
          ${c.nome ? `<span class="conversa-nome">${c.nome}</span>` : ''}
          <span class="conversa-preview">${c.ultima_mensagem || ''}</span>
          <div class="conversa-meta">
            <span class="conversa-nivel nivel-${nivel}">${nivel}</span>
            <span class="conversa-data">${formatarData(c.atualizado_em)}</span>
          </div>
        </div>`;
    }).join('');

    lista.querySelectorAll('.conversa-item').forEach(el => {
      el.addEventListener('click', () => abrirConversa(el.dataset.telefone));
    });
  }

  function renderPaginacaoConversas(pagina, totalPaginas, total) {
    const pag = document.getElementById('paginacao-conversas');
    if (!totalPaginas || totalPaginas <= 1) {
      pag.innerHTML = `<span>${total || 0} conversa(s)</span>`;
      return;
    }
    pag.innerHTML = `
      <button class="btn-pag" id="pag-conv-ant" ${pagina <= 1 ? 'disabled' : ''}>◀</button>
      <span>${pagina} / ${totalPaginas}</span>
      <button class="btn-pag" id="pag-conv-prox" ${pagina >= totalPaginas ? 'disabled' : ''}>▶</button>
    `;
    document.getElementById('pag-conv-ant').addEventListener('click', () => carregarConversas(pagina - 1));
    document.getElementById('pag-conv-prox').addEventListener('click', () => carregarConversas(pagina + 1));
  }

  // ── Chat / Mensagens ────────────────────────────────────────

  async function abrirConversa(telefone) {
    telefoneAtivo = telefone;
    paginaMensagens = 1;

    document.getElementById('chat-titulo').textContent = `📱 ${telefone}`;
    document.getElementById('chat-mensagens').innerHTML = '<p class="msg-carregando">Carregando mensagens...</p>';
    document.getElementById('paginacao-mensagens').innerHTML = '';
    document.getElementById('btn-classificar').disabled = false;
    document.getElementById('classificacao-controls').style.display = 'flex';
    resetarClassificacao();

    // Destacar item ativo na lista
    document.querySelectorAll('.conversa-item').forEach(el => {
      el.classList.toggle('ativa', el.dataset.telefone === telefone);
    });

    await carregarMensagens(telefone, 1);
  }

  async function carregarMensagens(telefone, pagina) {
    paginaMensagens = pagina;
    const qs = buildQuery({ page: pagina, limit: LIMIT_MENSAGENS });

    try {
      const res = await fetch(`${API}/mensagens/${encodeURIComponent(telefone)}?${qs}`);
      if (!res.ok) throw new Error('Erro ao carregar mensagens');
      const data = await res.json();

      totalMensagens = data.total || 0;
      renderMensagens(data.dados || []);
      renderPaginacaoMensagens(telefone, pagina, totalMensagens);
    } catch (err) {
      document.getElementById('chat-mensagens').innerHTML = `<p class="msg-vazia">Erro: ${err.message}</p>`;
    }
  }

  function buildBolhaHtml(m) {
    const dir = m.direcao === 'SAIDA' ? 'SAIDA' : 'ENTRADA';
    const badgeProcessada = m.direcao === 'ENTRADA'
      ? `<span class="msg-badge ${m.processada_ia ? 'badge-processada' : 'badge-nao-processada'}">${m.processada_ia ? '✓ Processada' : '⏳ Não processada'}</span>`
      : '';
    const badgeIntencao = m.intencao_classificada
      ? `<span class="msg-badge badge-intencao-msg">🏷 ${esc(m.intencao_classificada)}</span>`
      : '';
    return `
      <div class="bolha bolha-${dir}">
        <span>${m.mensagem || ''}</span>
        <div class="bolha-meta">
          <span class="bolha-tipo">${m.tipo || ''}</span>
          <span>${formatarData(m.criada_em)}</span>
        </div>
        ${badgeProcessada || badgeIntencao ? `<div class="bolha-badges">${badgeProcessada}${badgeIntencao}</div>` : ''}
      </div>`;
  }

  function renderMensagens(mensagens) {
    const container = document.getElementById('chat-mensagens');
    if (!mensagens.length) {
      container.innerHTML = '<p class="msg-vazia">Nenhuma mensagem encontrada.</p>';
      return;
    }

    container.innerHTML = mensagens.map(m => buildBolhaHtml(m)).join('');

    // Scroll para o fim ao carregar a primeira página
    if (paginaMensagens === 1) {
      container.scrollTop = container.scrollHeight;
    }
  }

  function renderPaginacaoMensagens(telefone, pagina, total) {
    const totalPaginas = Math.ceil(total / LIMIT_MENSAGENS);
    const pag = document.getElementById('paginacao-mensagens');
    if (!totalPaginas || totalPaginas <= 1) {
      pag.innerHTML = `<span>${total} mensagem(s)</span>`;
      return;
    }
    pag.innerHTML = `
      <button class="btn-pag" id="pag-msg-ant" ${pagina <= 1 ? 'disabled' : ''}>◀</button>
      <span>${pagina} / ${totalPaginas} (${total} msg)</span>
      <button class="btn-pag" id="pag-msg-prox" ${pagina >= totalPaginas ? 'disabled' : ''}>▶</button>
    `;
    document.getElementById('pag-msg-ant').addEventListener('click', () => carregarMensagens(telefone, pagina - 1));
    document.getElementById('pag-msg-prox').addEventListener('click', () => carregarMensagens(telefone, pagina + 1));
  }

  // ── Classificação de Intenção ───────────────────────────────

  function resetarClassificacao() {
    const badge = document.getElementById('badge-intencao');
    const status = document.getElementById('status-classificacao');
    badge.textContent = '';
    badge.className = 'badge-intencao oculto';
    status.textContent = '';
  }

  async function classificarIntencao() {
    if (!telefoneAtivo) return;

    const btn = document.getElementById('btn-classificar');
    const badge = document.getElementById('badge-intencao');
    const status = document.getElementById('status-classificacao');

    btn.disabled = true;
    status.textContent = 'Classificando...';
    badge.className = 'badge-intencao oculto';

    try {
      const res = await fetch(`/bot/classificar-intencao/${encodeURIComponent(telefoneAtivo)}`, {
        method: 'POST'
      });
      const data = await res.json();

      if (!res.ok) {
        status.textContent = data.message || 'Erro ao classificar';
        return;
      }

      const intencao = data.intencao || INTENCAO_DESCONHECIDO;
      badge.textContent = intencao;
      badge.className = `badge-intencao${intencao === INTENCAO_DESCONHECIDO ? ' desconhecido' : ''}`;
      status.textContent = '';

      recarregarMensagensAtivas();
      atualizarListaSilenciosa();

      // Dispara pipeline de ações autônomas com base na intenção classificada.
      // O classificador atual não retorna pontuação de confiança; usa-se 1 (máximo)
      // pois a classificação já foi confirmada pelo modelo de IA no servidor.
      if (intencao !== INTENCAO_DESCONHECIDO && window.BotAdmin && window.BotAdmin.emitIntent) {
        window.BotAdmin.emitIntent({ name: intencao, confidence: 1, entities: {} });
      }
    } catch (err) {
      status.textContent = 'Erro de conexão';
    } finally {
      btn.disabled = false;
    }
  }

  // ── Init ────────────────────────────────────────────────────

  document.getElementById('btn-filtrar').addEventListener('click', () => carregarConversas(1));
  document.getElementById('btn-classificar').addEventListener('click', classificarIntencao);

  document.getElementById('filtro-telefone').addEventListener('keydown', e => {
    if (e.key === 'Enter') carregarConversas(1);
  });

  carregarConversas(1);
  conectarWs();
})();
