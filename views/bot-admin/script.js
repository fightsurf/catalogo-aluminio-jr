(() => {
  const API = '/bot/admin';
  const API_INTENCOES_ATIVAS = '/bot/intencoes';
  const INTENCAO_DESCONHECIDO = 'DESCONHECIDO';

  let paginaConversas = 1;
  let totalPaginasConversas = 1;
  let telefoneAtivo = null;
  let paginaMensagens = 1;
  let totalMensagens = 0;
  const LIMIT_MENSAGENS = 50;

  let autonomiaAtiva = false;
  let intencoesAtivas = [];

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

  // ── Bot autonomia ────────────────────────────────────────────

  function renderBotAutonomia() {
    const btn = document.getElementById('btn-autonomia');
    const status = document.getElementById('status-autonomia');
    if (!btn || !status) return;

    if (autonomiaAtiva) {
      btn.textContent = '🟢 Bot ON';
      btn.style.background = '#1a7f37';
      btn.style.color = '#fff';
      status.textContent = 'Autônomo ativo';
    } else {
      btn.textContent = '🔴 Bot OFF';
      btn.style.background = '#d1242f';
      btn.style.color = '#fff';
      status.textContent = 'Autônomo desligado';
    }
  }

  async function carregarStatusAutonomia() {
    try {
      const res = await fetch('/bot/autonomia/status');
      if (!res.ok) throw new Error('Falha ao carregar status do bot');

      const data = await res.json();
      autonomiaAtiva = !!data.ativa;
      renderBotAutonomia();
    } catch (err) {
      console.error('[BotAdmin] erro ao carregar autonomia:', err);
    }
  }

  async function alternarAutonomia() {
    const proximoValor = !autonomiaAtiva;

    try {
      const res = await fetch('/bot/autonomia/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ativa: proximoValor })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Erro ao alterar autonomia');
      }

      autonomiaAtiva = !!data.ativa;
      renderBotAutonomia();
    } catch (err) {
      console.error('[BotAdmin] erro ao alterar autonomia:', err);
      alert('Erro ao alterar autonomia do bot.');
    }
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

  function resetarStatusExecucaoIntencao() {
    const status = document.getElementById('status-execucao-intencao');
    if (status) {
      status.textContent = '';
    }
  }

  function preencherSelectIntencoes() {
    const select = document.getElementById('select-intencao-manual');
    const btnExecutar = document.getElementById('btn-executar-intencao');
    if (!select || !btnExecutar) return;

    if (!intencoesAtivas.length) {
      select.innerHTML = '<option value="">Nenhuma intenção cadastrada</option>';
      select.disabled = true;
      btnExecutar.disabled = true;
      return;
    }

    const valorAtual = select.value;
    select.innerHTML = [
      '<option value="">Selecione a intenção</option>',
      ...intencoesAtivas.map(intencao => (
        `<option value="${esc(intencao.nome)}">${esc(intencao.nome)}${intencao.ativa === false ? ' (inativa)' : ''}${intencao.descricao ? ` — ${esc(intencao.descricao)}` : ''}</option>`
      ))
    ].join('');

    if (valorAtual && intencoesAtivas.some(item => item.nome === valorAtual)) {
      select.value = valorAtual;
    }

    select.disabled = false;
    btnExecutar.disabled = !telefoneAtivo || !select.value;
  }

  async function carregarIntencoesAtivas() {
    const select = document.getElementById('select-intencao-manual');
    const btnExecutar = document.getElementById('btn-executar-intencao');

    if (select) {
      select.disabled = true;
      select.innerHTML = '<option value="">Carregando intenções...</option>';
    }

    if (btnExecutar) {
      btnExecutar.disabled = true;
    }

    try {
      const res = await fetch(API_INTENCOES_ATIVAS);
      if (!res.ok) throw new Error('Erro ao carregar intenções');

      const data = await res.json();
      intencoesAtivas = Array.isArray(data) ? data : [];
      preencherSelectIntencoes();
    } catch (err) {
      intencoesAtivas = [];
      if (select) {
        select.innerHTML = '<option value="">Erro ao carregar intenções</option>';
        select.disabled = true;
      }
      if (btnExecutar) {
        btnExecutar.disabled = true;
      }
      console.error('[BotAdmin] erro ao carregar intenções:', err);
    }
  }

  async function executarIntencaoManual() {
    if (!telefoneAtivo) return;

    const select = document.getElementById('select-intencao-manual');
    const btn = document.getElementById('btn-executar-intencao');
    const status = document.getElementById('status-execucao-intencao');
    const intencao = String(select?.value || '').trim();

    if (!intencao) {
      if (status) status.textContent = 'Selecione uma intenção';
      return;
    }

    btn.disabled = true;
    if (select) select.disabled = true;
    if (status) status.textContent = 'Executando...';

    try {
      const res = await fetch('/bot/admin/executar-intencao', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telefone: telefoneAtivo, intencao })
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || 'Erro ao executar intenção');
      }

      if (status) {
        status.textContent = `Intenção ${data.intencao} executada (${data.total_acoes} ação(ões))`;
      }

      atualizarListaSilenciosa();
      recarregarMensagensAtivas();
    } catch (err) {
      if (status) {
        status.textContent = `Erro: ${err.message}`;
      }
    } finally {
      preencherSelectIntencoes();
    }
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
    resetarStatusExecucaoIntencao();
    preencherSelectIntencoes();

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

  function selecionarIntencaoManual(intencao) {
    const select = document.getElementById('select-intencao-manual');
    const btn = document.getElementById('btn-executar-intencao');
    if (!select) return;

    if (intencao && intencoesAtivas.some(item => item.nome === intencao)) {
      select.value = intencao;
    }

    if (btn) {
      btn.disabled = !telefoneAtivo || !select.value;
    }
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
      selecionarIntencaoManual(intencao);

      recarregarMensagensAtivas();
      atualizarListaSilenciosa();

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

  if (window.BotBus) {
    window.BotBus.addEventListener('bot:action-decision', function (e) {
      const { decision } = e.detail || {};
      if (!decision || decision.autonomous !== true) return;
      if (!telefoneAtivo) return;

      fetch('/bot/fluxo/executar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telefone: telefoneAtivo, intencao: decision.intentName })
      }).catch(function (err) {
        console.error('[BotAdmin] Erro ao executar fluxo autônomo:', err);
      });
    });
  }

  document.getElementById('btn-filtrar').addEventListener('click', () => carregarConversas(1));
  document.getElementById('btn-classificar').addEventListener('click', classificarIntencao);
  document.getElementById('btn-executar-intencao').addEventListener('click', executarIntencaoManual);
  document.getElementById('select-intencao-manual').addEventListener('change', e => {
    const btn = document.getElementById('btn-executar-intencao');
    resetarStatusExecucaoIntencao();
    btn.disabled = !telefoneAtivo || !e.target.value;
  });

  document.getElementById('filtro-telefone').addEventListener('keydown', e => {
    if (e.key === 'Enter') carregarConversas(1);
  });

  const btnAutonomia = document.getElementById('btn-autonomia');
  if (btnAutonomia) {
    btnAutonomia.addEventListener('click', alternarAutonomia);
  }

  carregarStatusAutonomia();
  carregarIntencoesAtivas();
  carregarConversas(1);
  conectarWs();
})();
