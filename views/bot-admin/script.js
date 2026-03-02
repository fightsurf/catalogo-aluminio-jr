(() => {
  const API = '/bot/admin';

  let paginaConversas = 1;
  let totalPaginasConversas = 1;
  let telefoneAtivo = null;
  let paginaMensagens = 1;
  let totalMensagens = 0;
  const LIMIT_MENSAGENS = 50;

  // ── Helpers ────────────────────────────────────────────────

  function formatarData(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
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

  function renderMensagens(mensagens) {
    const container = document.getElementById('chat-mensagens');
    if (!mensagens.length) {
      container.innerHTML = '<p class="msg-vazia">Nenhuma mensagem encontrada.</p>';
      return;
    }

    container.innerHTML = mensagens.map(m => {
      const dir = m.direcao === 'SAIDA' ? 'SAIDA' : 'ENTRADA';
      return `
        <div class="bolha bolha-${dir}">
          <span>${m.mensagem || ''}</span>
          <div class="bolha-meta">
            <span class="bolha-tipo">${m.tipo || ''}</span>
            <span>${formatarData(m.criada_em)}</span>
          </div>
        </div>`;
    }).join('');

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

  // ── Init ────────────────────────────────────────────────────

  document.getElementById('btn-filtrar').addEventListener('click', () => carregarConversas(1));

  document.getElementById('filtro-telefone').addEventListener('keydown', e => {
    if (e.key === 'Enter') carregarConversas(1);
  });

  carregarConversas(1);
})();
