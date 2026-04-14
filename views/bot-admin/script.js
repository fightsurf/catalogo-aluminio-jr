(() => {
  const API = '/bot/admin';
  const INTENCAO_DESCONHECIDO = 'DESCONHECIDO';

  let paginaConversas = 1;
  let totalPaginasConversas = 1;
  let telefoneAtivo = null;
  let paginaMensagens = 1;
  let totalMensagens = 0;
  const LIMIT_MENSAGENS = 50;

  let autonomiaAtiva = false;
  let intencoesDisponiveis = [];

  const WS_URL = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/bot-admin`;
  const BACKOFF = [2000, 5000, 10000];
  let wsAttempt = 0;
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

  function renderBotAutonomia() {
    const btn = document.getElementById('btn-autonomia');
    const status = document.getElementById('status-autonomia');
    if (!btn || !status) return;

    if (autonomiaAtiva) {
      btn.textContent = '🟢 Bot ON';
      btn.style.background = '#2e7d32';
      btn.style.color = '#fff';
      status.textContent = 'Autônomo ativo';
    } else {
      btn.textContent = '🔴 Bot OFF';
      btn.style.background = '#b71c1c';
      btn.style.color = '#fff';
      status.textContent = 'Autônomo desligado';
    }
  }

  function normalizarTelefone(telefone) {
    return String(telefone || '').replace(/\D/g, '');
  }

  function atualizarEstadoExecucaoIntencao() {
    const select = document.getElementById('select-intencao-executar');
    const btn = document.getElementById('btn-executar-intencao');
    if (!select || !btn) return;

    const temTelefone = !!normalizarTelefone(telefoneAtivo);
    const temIntencao = !!String(select.value || '').trim();
    btn.disabled = !(temTelefone && temIntencao);
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

  async function carregarIntencoes() {
    const select = document.getElementById('select-intencao-executar');
    if (!select) return;

    select.innerHTML = '<option value="">Carregando intenções...</option>';
    atualizarEstadoExecucaoIntencao();

    try {
      const res = await fetch('/bot/intencoes');
      if (!res.ok) throw new Error('Erro ao carregar intenções');

      const data = await res.json();
      const lista = Array.isArray(data) ? data : [];
      intencoesDisponiveis = lista.filter(item => item && item.nome && item.ativa !== false);

      if (!intencoesDisponiveis.length) {
        select.innerHTML = '<option value="">Nenhuma intenção disponível</option>';
        atualizarEstadoExecucaoIntencao();
        return;
      }

      intencoesDisponiveis.sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR'));
      select.innerHTML = [
        '<option value="">Selecione a intenção</option>',
        ...intencoesDisponiveis.map(item => `<option value="${esc(item.nome)}">${esc(item.nome)}</option>`)
      ].join('');
      atualizarEstadoExecucaoIntencao();
    } catch (err) {
      console.error('[BotAdmin] erro ao carregar intenções:', err);
      select.innerHTML = '<option value="">Erro ao carregar intenções</option>';
      atualizarEstadoExecucaoIntencao();
    }
  }

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
      nivel_atendimento: document.getElementById('filtro-nivel').value
    };
  }

  function buildQuery(params) {
    return Object.entries(params)
      .filter(([, v]) => v !== '' && v != null)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');
  }

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
      lista.innerHTML = '<p class="msg-vazia">Nenhum telefone encontrado.</p>';
      return;
    }

    lista.innerHTML = conversas.map(c => {
      const ativa = normalizarTelefone(c.telefone) === normalizarTelefone(telefoneAtivo) ? ' ativa' : '';
      return `
        <div class="conversa-item${ativa}" data-telefone="${esc(c.telefone)}" title="${esc(c.telefone)}">
          <span class="conversa-telefone">${esc(c.telefone)}</span>
        </div>`;
    }).join('');

    lista.querySelectorAll('.conversa-item').forEach(el => {
      el.addEventListener('click', () => abrirConversa(el.dataset.telefone));
    });
  }

  function renderPaginacaoConversas(pagina, totalPaginas, total) {
    const pag = document.getElementById('paginacao-conversas');
    if (!totalPaginas || totalPaginas <= 1) {
      pag.innerHTML = `<span>${total || 0} telefone(s)</span>`;
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

  async function abrirConversa(telefone, opcoes = {}) {
    const tel = normalizarTelefone(telefone);
    if (!tel) {
      alert('Digite um telefone válido.');
      return;
    }

    telefoneAtivo = tel;
    paginaMensagens = 1;

    const manual = !!opcoes.manual;
    document.getElementById('chat-titulo').textContent = `📱 ${tel}`;
    document.getElementById('chat-subtitulo').textContent = manual
      ? 'Conversa manual aberta para disparo de intenção.'
      : 'Histórico do telefone selecionado.';
    document.getElementById('chat-mensagens').innerHTML = '<p class="msg-carregando">Carregando mensagens...</p>';
    document.getElementById('paginacao-mensagens').innerHTML = '';
    document.getElementById('btn-classificar').disabled = false;
    document.getElementById('classificacao-controls').style.display = 'flex';
    document.getElementById('acoes-conversa').classList.remove('oculto');
    limparStatusExecucaoIntencao();
    resetarClassificacao();
    atualizarEstadoExecucaoIntencao();

    document.querySelectorAll('.conversa-item').forEach(el => {
      el.classList.toggle('ativa', normalizarTelefone(el.dataset.telefone) === tel);
    });

    await carregarMensagens(tel, 1, { manual });
  }

  async function carregarMensagens(telefone, pagina, opcoes = {}) {
    paginaMensagens = pagina;
    const qs = buildQuery({ page: pagina, limit: LIMIT_MENSAGENS });

    try {
      const res = await fetch(`${API}/mensagens/${encodeURIComponent(telefone)}?${qs}`);
      if (!res.ok) throw new Error('Erro ao carregar mensagens');
      const data = await res.json();

      totalMensagens = data.total || 0;
      renderMensagens(data.dados || [], opcoes);
      renderPaginacaoMensagens(telefone, pagina, totalMensagens, opcoes);
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
        <span>${esc(m.mensagem || '')}</span>
        <div class="bolha-meta">
          <span class="bolha-tipo">${esc(m.tipo || '')}</span>
          <span>${formatarData(m.criada_em)}</span>
        </div>
        ${badgeProcessada || badgeIntencao ? `<div class="bolha-badges">${badgeProcessada}${badgeIntencao}</div>` : ''}
      </div>`;
  }

  function renderMensagens(mensagens, opcoes = {}) {
    const container = document.getElementById('chat-mensagens');
    if (!mensagens.length) {
      container.innerHTML = opcoes.manual
        ? '<p class="msg-vazia">Nenhuma mensagem encontrada. Você já pode executar uma intenção para este número.</p>'
        : '<p class="msg-vazia">Nenhuma mensagem encontrada.</p>';
      return;
    }

    container.innerHTML = mensagens.map(m => buildBolhaHtml(m)).join('');

    if (paginaMensagens === 1) {
      container.scrollTop = container.scrollHeight;
    }
  }

  function renderPaginacaoMensagens(telefone, pagina, total, opcoes = {}) {
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

    document.getElementById('pag-msg-ant').addEventListener('click', () => carregarMensagens(telefone, pagina - 1, opcoes));
    document.getElementById('pag-msg-prox').addEventListener('click', () => carregarMensagens(telefone, pagina + 1, opcoes));
  }

  function resetarClassificacao() {
    const badge = document.getElementById('badge-intencao');
    const status = document.getElementById('status-classificacao');
    badge.textContent = '';
    badge.className = 'badge-intencao oculto';
    status.textContent = '';
  }

  function limparStatusExecucaoIntencao() {
    const status = document.getElementById('status-execucao-intencao');
    if (status) {
      status.textContent = '';
      status.className = 'status-execucao-intencao';
    }
  }

  function definirStatusExecucaoIntencao(texto, tipo = '') {
    const status = document.getElementById('status-execucao-intencao');
    if (!status) return;
    status.textContent = texto;
    status.className = `status-execucao-intencao${tipo ? ` ${tipo}` : ''}`;
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

      const select = document.getElementById('select-intencao-executar');
      if (select && intencao !== INTENCAO_DESCONHECIDO) {
        const existe = Array.from(select.options).some(option => option.value === intencao);
        if (existe) {
          select.value = intencao;
        }
      }

      atualizarEstadoExecucaoIntencao();
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

  async function executarIntencaoManual() {
    if (!telefoneAtivo) {
      alert('Abra ou selecione uma conversa primeiro.');
      return;
    }

    const select = document.getElementById('select-intencao-executar');
    const btn = document.getElementById('btn-executar-intencao');
    const intencao = String(select.value || '').trim().toUpperCase();

    if (!intencao) {
      alert('Selecione uma intenção.');
      return;
    }

    btn.disabled = true;
    definirStatusExecucaoIntencao('Executando fluxo...', 'info');

    try {
      const res = await fetch('/bot/fluxo/executar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telefone: telefoneAtivo, intencao })
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.message || 'Erro ao executar fluxo');
      }

      definirStatusExecucaoIntencao(`Fluxo ${intencao} disparado para ${telefoneAtivo}.`, 'success');
    } catch (err) {
      console.error('[BotAdmin] erro ao executar intenção manual:', err);
      definirStatusExecucaoIntencao(err.message || 'Erro ao executar fluxo.', 'error');
    } finally {
      atualizarEstadoExecucaoIntencao();
    }
  }

  function abrirConversaManualPeloCampo() {
    const input = document.getElementById('novo-telefone');
    const telefone = normalizarTelefone(input.value);

    if (!telefone) {
      alert('Digite um telefone válido.');
      input.focus();
      return;
    }

    input.value = telefone;
    abrirConversa(telefone, { manual: true });
  }

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
  document.getElementById('btn-abrir-conversa').addEventListener('click', abrirConversaManualPeloCampo);
  document.getElementById('select-intencao-executar').addEventListener('change', atualizarEstadoExecucaoIntencao);

  document.getElementById('filtro-telefone').addEventListener('keydown', e => {
    if (e.key === 'Enter') carregarConversas(1);
  });

  document.getElementById('novo-telefone').addEventListener('keydown', e => {
    if (e.key === 'Enter') abrirConversaManualPeloCampo();
  });

  const btnAutonomia = document.getElementById('btn-autonomia');
  if (btnAutonomia) {
    btnAutonomia.addEventListener('click', alternarAutonomia);
  }

  carregarStatusAutonomia();
  carregarIntencoes();
  carregarConversas(1);
  conectarWs();
})();
