(() => {
  const API = '/bot/admin';
  const API_INTENCOES = '/bot/intencoes';
  const API_EXECUTAR_INTENCAO = '/bot/admin/executar-intencao';
  const INTENCAO_DESCONHECIDO = 'DESCONHECIDO';
  const LIMIT_CONVERSAS = 20;
  const LIMIT_MENSAGENS = 50;

  let paginaConversas = 1;
  let totalPaginasConversas = 1;
  let telefoneAtivo = null;
  let paginaMensagens = 1;
  let totalMensagens = 0;
  let autonomiaAtiva = false;
  let intencoesAtivas = [];

  const WS_URL = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/bot-admin`;
  const BACKOFF = [2000, 5000, 10000];
  let wsAttempt = 0;
  let fallbackTimer = null;
  let wsInstance = null;

  function el(id) {
    return document.getElementById(id);
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

  function normalizarTelefone(valor) {
    return String(valor || '').replace(/\D/g, '');
  }

  function getFiltros() {
    return {
      telefone: normalizarTelefone(el('filtro-telefone')?.value || ''),
      nivel_atendimento: el('filtro-nivel')?.value || ''
    };
  }

  function buildQuery(params) {
    return Object.entries(params)
      .filter(([, v]) => v !== '' && v != null)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');
  }

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
      wsAttempt += 1;
      setTimeout(conectarWs, delay);
    };

    ws.onerror = () => {
      ws.close();
    };
  }

  function renderBotAutonomia() {
    const btn = el('btn-autonomia');
    const status = el('status-autonomia');
    if (!btn || !status) return;

    if (autonomiaAtiva) {
      btn.textContent = '🟢 Bot ON';
      btn.style.background = '#2f855a';
      btn.style.color = '#fff';
      status.textContent = 'Autônomo ativo';
    } else {
      btn.textContent = '🔴 Bot OFF';
      btn.style.background = '#c53030';
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

  function resetarClassificacao() {
    const badge = el('badge-intencao');
    const status = el('status-classificacao');
    if (badge) {
      badge.textContent = '';
      badge.className = 'badge-intencao oculto';
    }
    if (status) {
      status.textContent = '';
    }
  }

  function resetarStatusExecucaoIntencao() {
    const status = el('status-execucao-intencao');
    if (status) status.textContent = '';
  }

  function atualizarTituloConversa() {
    el('chat-titulo').textContent = telefoneAtivo ? `Conversa ativa: ${telefoneAtivo}` : 'Selecione uma conversa';
  }

  function marcarConversaAtivaNaLista() {
    document.querySelectorAll('.conversa-item').forEach((item) => {
      item.classList.toggle('ativa', item.dataset.telefone === telefoneAtivo);
    });
  }

  function atualizarEstadoAcoes() {
    const btnClassificar = el('btn-classificar');
    const select = el('select-intencao-manual');
    const btnExecutar = el('btn-executar-intencao');

    if (btnClassificar) {
      btnClassificar.disabled = !telefoneAtivo;
    }

    if (select) {
      select.disabled = !intencoesAtivas.length;
    }

    if (btnExecutar) {
      btnExecutar.disabled = !telefoneAtivo || !select || !select.value;
    }
  }

  function preencherSelectIntencoes() {
    const select = el('select-intencao-manual');
    if (!select) return;

    const valorAtual = select.value;

    if (!intencoesAtivas.length) {
      select.innerHTML = '<option value="">Nenhuma intenção cadastrada</option>';
      select.disabled = true;
      atualizarEstadoAcoes();
      return;
    }

    select.innerHTML = [
      '<option value="">Selecione a intenção</option>',
      ...intencoesAtivas.map((intencao) => (
        `<option value="${esc(intencao.nome)}">${esc(intencao.nome)}${intencao.ativa === false ? ' (inativa)' : ''}${intencao.descricao ? ` — ${esc(intencao.descricao)}` : ''}</option>`
      ))
    ].join('');

    if (valorAtual && intencoesAtivas.some((item) => item.nome === valorAtual)) {
      select.value = valorAtual;
    }

    atualizarEstadoAcoes();
  }

  async function carregarIntencoes() {
    const select = el('select-intencao-manual');
    if (select) {
      select.disabled = true;
      select.innerHTML = '<option value="">Carregando intenções...</option>';
    }

    try {
      const res = await fetch(API_INTENCOES);
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
      atualizarEstadoAcoes();
      console.error('[BotAdmin] erro ao carregar intenções:', err);
    }
  }

  async function carregarConversas(pagina = 1) {
    paginaConversas = pagina;
    const qs = buildQuery({ ...getFiltros(), page: pagina, limit: LIMIT_CONVERSAS });
    const lista = el('lista-conversas');
    lista.innerHTML = '<p class="msg-carregando">Carregando...</p>';

    try {
      const res = await fetch(`${API}/conversas?${qs}`);
      if (!res.ok) throw new Error('Erro ao carregar conversas');
      const data = await res.json();
      totalPaginasConversas = data.total_paginas || 1;
      renderConversas(data.dados || []);
      renderPaginacaoConversas(data.pagina || 1, data.total_paginas || 1, data.total || 0);
    } catch (err) {
      lista.innerHTML = `<p class="msg-vazia">Erro: ${esc(err.message)}</p>`;
    }
  }

  async function atualizarListaSilenciosa() {
    const qs = buildQuery({ ...getFiltros(), page: paginaConversas, limit: LIMIT_CONVERSAS });
    try {
      const res = await fetch(`${API}/conversas?${qs}`);
      if (!res.ok) return;
      const data = await res.json();
      totalPaginasConversas = data.total_paginas || 1;
      renderConversas(data.dados || []);
      renderPaginacaoConversas(data.pagina || 1, data.total_paginas || 1, data.total || 0);
    } catch (_) {}
  }

  function renderConversas(conversas) {
    const lista = el('lista-conversas');
    if (!conversas.length) {
      lista.innerHTML = '<p class="msg-vazia">Nenhum telefone encontrado.</p>';
      return;
    }

    lista.innerHTML = conversas.map((conversa) => {
      const ativa = conversa.telefone === telefoneAtivo ? ' ativa' : '';
      return `
        <div
          class="conversa-item${ativa}"
          data-telefone="${esc(conversa.telefone)}"
          title="${esc((conversa.ultima_mensagem || '').slice(0, 120))}"
        >
          <span class="conversa-telefone">${esc(conversa.telefone)}</span>
        </div>`;
    }).join('');

    lista.querySelectorAll('.conversa-item').forEach((item) => {
      item.addEventListener('click', () => abrirConversa(item.dataset.telefone));
    });
  }

  function renderPaginacaoConversas(pagina, totalPaginas, total) {
    const pag = el('paginacao-conversas');
    if (!totalPaginas || totalPaginas <= 1) {
      pag.innerHTML = `<span>${total} telefone(s)</span>`;
      return;
    }

    pag.innerHTML = `
      <button class="btn-pag" id="pag-conv-ant" ${pagina <= 1 ? 'disabled' : ''}>◀</button>
      <span>${pagina} / ${totalPaginas}</span>
      <button class="btn-pag" id="pag-conv-prox" ${pagina >= totalPaginas ? 'disabled' : ''}>▶</button>
    `;

    el('pag-conv-ant').addEventListener('click', () => carregarConversas(pagina - 1));
    el('pag-conv-prox').addEventListener('click', () => carregarConversas(pagina + 1));
  }

  async function abrirConversa(telefone) {
    const telefoneNormalizado = normalizarTelefone(telefone);
    if (!telefoneNormalizado) return;

    telefoneAtivo = telefoneNormalizado;
    paginaMensagens = 1;
    atualizarTituloConversa();
    marcarConversaAtivaNaLista();
    resetarClassificacao();
    resetarStatusExecucaoIntencao();
    atualizarEstadoAcoes();

    const campoNovoTelefone = el('novo-telefone');
    if (campoNovoTelefone) {
      campoNovoTelefone.value = telefoneNormalizado;
    }

    el('chat-mensagens').innerHTML = '<p class="msg-carregando">Carregando mensagens...</p>';
    el('paginacao-mensagens').innerHTML = '';

    await carregarMensagens(telefoneNormalizado, 1);
  }

  async function abrirConversaManual() {
    const campo = el('novo-telefone');
    const btn = el('btn-abrir-conversa');
    const telefone = normalizarTelefone(campo?.value || '');

    if (!telefone) {
      alert('Digite um número de telefone válido.');
      return;
    }

    try {
      if (btn) {
        btn.disabled = true;
        btn.textContent = 'Abrindo...';
      }

      const res = await fetch(`${API}/conversas/abrir`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telefone })
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.message || 'Erro ao iniciar conversa');
      }

      const telefoneAberto = normalizarTelefone(data.conversa?.telefone || telefone);
      await abrirConversa(telefoneAberto);
      atualizarListaSilenciosa();
    } catch (err) {
      alert(err.message || 'Erro ao iniciar conversa.');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Abrir';
      }
    }
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
      el('chat-mensagens').innerHTML = `<p class="msg-vazia">Erro: ${esc(err.message)}</p>`;
    }
  }

  async function recarregarMensagensAtivas() {
    if (!telefoneAtivo) return;
    const container = el('chat-mensagens');
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

  function buildBolhaHtml(mensagem) {
    const direcao = mensagem.direcao === 'SAIDA' ? 'SAIDA' : 'ENTRADA';
    const badgeProcessada = mensagem.direcao === 'ENTRADA'
      ? `<span class="msg-badge ${mensagem.processada_ia ? 'badge-processada' : 'badge-nao-processada'}">${mensagem.processada_ia ? '✓ Processada' : '⏳ Não processada'}</span>`
      : '';
    const badgeIntencao = mensagem.intencao_classificada
      ? `<span class="msg-badge badge-intencao-msg">🏷 ${esc(mensagem.intencao_classificada)}</span>`
      : '';

    return `
      <div class="bolha bolha-${direcao}">
        <span>${mensagem.mensagem || ''}</span>
        <div class="bolha-meta">
          <span class="bolha-tipo">${esc(mensagem.tipo || '')}</span>
          <span>${formatarData(mensagem.criada_em)}</span>
        </div>
        ${badgeProcessada || badgeIntencao ? `<div class="bolha-badges">${badgeProcessada}${badgeIntencao}</div>` : ''}
      </div>`;
  }

  function renderMensagens(mensagens) {
    const container = el('chat-mensagens');
    if (!mensagens.length) {
      container.innerHTML = telefoneAtivo
        ? '<p class="msg-vazia">Conversa iniciada. Selecione uma intenção e clique em Executar.</p>'
        : '<p class="msg-vazia">Nenhuma mensagem encontrada para este número.</p>';
      return;
    }

    container.innerHTML = mensagens.map((mensagem) => buildBolhaHtml(mensagem)).join('');
    if (paginaMensagens === 1) {
      container.scrollTop = container.scrollHeight;
    }
  }

  function renderMensagensSilencioso(mensagens, autoScroll) {
    const container = el('chat-mensagens');
    if (!mensagens.length) {
      container.innerHTML = '<p class="msg-vazia">Nenhuma mensagem encontrada para este número.</p>';
      return;
    }

    container.innerHTML = mensagens.map((mensagem) => buildBolhaHtml(mensagem)).join('');
    if (autoScroll) {
      container.scrollTop = container.scrollHeight;
    }
  }

  function renderPaginacaoMensagens(telefone, pagina, total) {
    const totalPaginas = Math.ceil(total / LIMIT_MENSAGENS);
    const pag = el('paginacao-mensagens');

    if (!totalPaginas || totalPaginas <= 1) {
      pag.innerHTML = `<span>${total} mensagem(ns)</span>`;
      return;
    }

    pag.innerHTML = `
      <button class="btn-pag" id="pag-msg-ant" ${pagina <= 1 ? 'disabled' : ''}>◀</button>
      <span>${pagina} / ${totalPaginas} (${total} msg)</span>
      <button class="btn-pag" id="pag-msg-prox" ${pagina >= totalPaginas ? 'disabled' : ''}>▶</button>
    `;

    el('pag-msg-ant').addEventListener('click', () => carregarMensagens(telefone, pagina - 1));
    el('pag-msg-prox').addEventListener('click', () => carregarMensagens(telefone, pagina + 1));
  }

  function selecionarIntencaoManual(intencao) {
    const select = el('select-intencao-manual');
    if (!select) return;

    if (intencao && intencoesAtivas.some((item) => item.nome === intencao)) {
      select.value = intencao;
    }

    atualizarEstadoAcoes();
  }

  async function classificarIntencao() {
    if (!telefoneAtivo) return;

    const btn = el('btn-classificar');
    const badge = el('badge-intencao');
    const status = el('status-classificacao');

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
    } catch (_) {
      status.textContent = 'Erro de conexão';
    } finally {
      btn.disabled = false;
      atualizarEstadoAcoes();
    }
  }

  async function executarIntencaoManual() {
    if (!telefoneAtivo) return;

    const select = el('select-intencao-manual');
    const btn = el('btn-executar-intencao');
    const status = el('status-execucao-intencao');
    const intencao = String(select?.value || '').trim();

    if (!intencao) {
      status.textContent = 'Selecione uma intenção';
      return;
    }

    btn.disabled = true;
    if (select) select.disabled = true;
    status.textContent = 'Executando...';

    try {
      const res = await fetch(API_EXECUTAR_INTENCAO, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telefone: telefoneAtivo, intencao })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Erro ao executar intenção');
      }

      status.textContent = `Intenção ${data.intencao} executada (${data.total_acoes} ação(ões))`;
      atualizarListaSilenciosa();
      recarregarMensagensAtivas();
    } catch (err) {
      status.textContent = `Erro: ${err.message}`;
    } finally {
      preencherSelectIntencoes();
    }
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

  el('btn-filtrar').addEventListener('click', () => carregarConversas(1));
  el('btn-classificar').addEventListener('click', classificarIntencao);
  el('btn-executar-intencao').addEventListener('click', executarIntencaoManual);
  el('btn-abrir-conversa').addEventListener('click', abrirConversaManual);
  el('btn-autonomia').addEventListener('click', alternarAutonomia);

  el('select-intencao-manual').addEventListener('change', () => {
    resetarStatusExecucaoIntencao();
    atualizarEstadoAcoes();
  });

  el('filtro-telefone').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') carregarConversas(1);
  });

  el('novo-telefone').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') abrirConversaManual();
  });

  atualizarTituloConversa();
  atualizarEstadoAcoes();
  carregarStatusAutonomia();
  carregarIntencoes();
  carregarConversas(1);
  conectarWs();
})();
