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
  let versaoCarregamentoMensagens = 0;
  let versaoAtualizacaoMensagens = 0;
  let autonomiaAtiva = false;
  let intencoesAtivas = [];
  let monitorCarregando = false;
  let ultimoMonitor = [];
  // Histórico apenas nesta aba; fechar/recarregar elimina os textos.
  const mensagensSessao = new Map();
  function receberAoVivo(dado) {
    const telefone = normalizarTelefone(dado.telefone);
    if (!telefone) return;
    const lista = mensagensSessao.get(telefone) || [];
    if (dado.zapi_message_id && lista.some(m => m.zapi_message_id === dado.zapi_message_id)) return;
    lista.push(dado);
    mensagensSessao.set(telefone, lista);
    if (telefone === telefoneAtivo) {
      renderMensagens(lista);
    }
  }


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
    const texto = String(valor || '').trim();
    // Preservar identificadores @lid, pois são a chave original de contato da Z-API.
    return /^\d+@lid$/i.test(texto) ? texto : texto.replace(/\D/g, '');
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
      recarregarMensagensAtivas();
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
        if (data.tipo === 'webhook_recebido' || data.tipo === 'nova_mensagem') {
          carregarMonitoramento();
        }
        if (data.evento === 'mensagem_ao_vivo') {
          receberAoVivo(data);
          atualizarListaSilenciosa();
        }
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


  function statusMonitor(msg, erro = false) {
    const elStatus = el('webhook-status');
    if (elStatus) {
      elStatus.textContent = msg;
      elStatus.style.color = erro ? '#a34037' : '';
    }
  }

  async function carregarMonitoramento() {
    if (monitorCarregando) return;
    monitorCarregando = true;
    try {
      const res = await fetch(`${API}/monitoramento`, { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      ultimoMonitor = Array.isArray(data.dados) ? data.dados : [];
      const direto = ultimoMonitor.filter(item => item.origem === 'Z-API direta');
      const ultima = direto[0] || null;
      const total = estado => direto.filter(item => item.estado === estado).length;
      const suas = direto.filter(item => item.direcao === 'SAIDA' && item.estado === 'registrada').length;
      const config = data.webhook_configurado === true;
      el('monitor-configuracao').textContent = config ? 'Webhook configurado' : 'Webhook sem chave no Render';
      el('monitor-ultima').textContent = ultima
        ? 'Último evento direto: ' + formatarData(ultima.recebido_em)
        : 'Nenhum evento direto registrado';
      el('monitor-contagens').textContent =
        `Diretas: ${total('registrada')} · Suas: ${suas} · Duplicadas: ${total('duplicada')} · Ignoradas: ${total('ignorada')} · Erros: ${total('erro')}`;
      statusMonitor(config ? 'Webhook: configuração pronta' : 'Webhook: falta configurar chave', !config);
      renderEventosMonitor(direto);
    } catch (error) {
      el('monitor-configuracao').textContent = 'Monitor indisponível';
      el('monitor-ultima').textContent = 'Falha ao consultar os eventos';
      statusMonitor('Falha ao consultar o webhook', true);
      const div = el('monitor-eventos-lista');
      if (div) div.textContent = 'Não foi possível carregar o histórico do webhook.';
      console.error('[BotAdmin] Monitoramento:', error.message);
    } finally {
      monitorCarregando = false;
    }
  }

  function renderEventosMonitor(eventos) {
    const div = el('monitor-eventos-lista');
    if (!div) return;
    if (!eventos.length) {
      div.textContent = 'Nenhuma chamada ao webhook direto registrada até agora.';
      return;
    }
    div.innerHTML = eventos.slice(0, 25).map(item => {
      const estado = String(item.estado || '');
      const classe = ['registrada', 'duplicada', 'ignorada', 'erro'].includes(estado) ? estado : '';
      const direcao = item.direcao === 'SAIDA' ? 'Sua mensagem' : item.direcao === 'ENTRADA' ? 'Recebida' : 'Evento';
      const descricao = item.mensagem || item.motivo || '';
      return `<div class="monitor-evento">
        <time>${esc(formatarData(item.recebido_em))}</time>
        <span class="evento-numero">${esc(item.telefone || '-')}</span>
        <span>${esc(direcao)}</span>
        <span class="monitor-estado ${classe}">${esc(estado)}</span>
        <span class="evento-texto">${esc(descricao)}</span>
      </div>`;
    }).join('');
  }

  function alternarDetalhesMonitor() {
    const painel = el('monitor-eventos');
    const btn = el('monitor-eventos-toggle');
    const abrir = painel.hasAttribute('hidden');
    if (abrir) painel.removeAttribute('hidden');
    else painel.setAttribute('hidden', '');
    btn.setAttribute('aria-expanded', String(abrir));
    btn.textContent = abrir ? 'Ocultar detalhes' : 'Detalhes';
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
      lista.innerHTML = '<p class="msg-vazia">Nenhum contato encontrado.</p>';
      return;
    }

    lista.innerHTML = conversas.map((conversa) => {
      const ativa = conversa.telefone === telefoneAtivo ? ' ativa' : '';
      const numero = String(conversa.telefone || '');
      const ehLid = /^\d+@lid$/i.test(numero);
      const nome = conversa.cliente_nome || conversa.nome || numero;
      const local = [conversa.cliente_cidade, conversa.cliente_uf].filter(Boolean).join(' - ');
      const sessao = mensagensSessao.get(numero) || [];
      const previa = sessao.length ? sessao[sessao.length - 1].mensagem : '';
      return `
        <div
          class="conversa-item${ativa}"
          data-telefone="${esc(numero)}"
          title="${esc(previa.slice(0, 120))}"
        >
          <div class="conversa-dados">
            <span class="conversa-telefone">${esc(nome)}</span>
            ${local ? `<span class="conversa-preview">${esc(local)}</span>` : ''}
            ${nome !== numero ? `<span class="conversa-numero">${esc(numero)}</span>` : ''}
            ${previa ? `<span class="conversa-preview">${esc(previa.slice(0, 120))}</span>` : ''}
          </div>
          ${ehLid ? '<small class="lid-pendente">Número não confirmado</small>' : ''}
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
    // Descarta atualizações pendentes da conversa anterior.
    versaoAtualizacaoMensagens += 1;
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
    el('chat-mensagens').scrollTop = 0;
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

  async function carregarMensagens(telefone, pagina = 1) {
    const versao = ++versaoCarregamentoMensagens;
    paginaMensagens = pagina;
    if (telefone !== telefoneAtivo || versao !== versaoCarregamentoMensagens) return;
    const mensagens = mensagensSessao.get(telefone) || [];
    totalMensagens = mensagens.length;
    renderMensagens(mensagens);
    el('paginacao-mensagens').innerHTML = '<span>Mensagens desta sessão: ' + totalMensagens + '</span>';
  }

  async function recarregarMensagensAtivas() {
    if (!telefoneAtivo) return;
    renderMensagens(mensagensSessao.get(telefoneAtivo) || []);
  }

  function buildBolhaHtml(mensagem) {
    const direcao = mensagem.direcao === 'SAIDA' ? 'SAIDA' : 'ENTRADA';
    const badgeProcessada = mensagem.zapi_message_id
      ? `<span class="msg-badge badge-processada">Z-API direta · ${direcao === 'SAIDA' ? 'Enviada por você' : 'Recebida'}</span>`
      : mensagem.direcao === 'ENTRADA'
      ? `<span class="msg-badge ${mensagem.processada_ia ? 'badge-processada' : 'badge-nao-processada'}">${mensagem.processada_ia ? '✓ Processada' : '⏳ Não processada'}</span>`
      : '';
    const badgeIntencao = mensagem.intencao_classificada
      ? `<span class="msg-badge badge-intencao-msg">🏷 ${esc(mensagem.intencao_classificada)}</span>`
      : '';

    return `
      <div class="bolha bolha-${direcao}">
        <span class="bolha-conteudo">${esc(mensagem.mensagem || '')}</span>
        <div class="bolha-meta">
          <span class="bolha-tipo">${esc(mensagem.tipo || '')}</span>
          <span>${formatarData(mensagem.criada_em)}</span>
        </div>
        ${badgeProcessada || badgeIntencao ? `<div class="bolha-badges">${badgeProcessada}${badgeIntencao}</div>` : ''}
      </div>`;
  }

  // Ao abrir uma conversa, mostrar a última mensagem independentemente
  // do ponto em que o scroll ficou na conversa anterior.
  function rolarAteUltimaMensagem() {
    const container = el('chat-mensagens');
    const telefone = telefoneAtivo;
    const versao = versaoCarregamentoMensagens;
    const posicionar = () => {
      if (telefone === telefoneAtivo && versao === versaoCarregamentoMensagens && paginaMensagens === 1) {
        container.scrollTop = container.scrollHeight;
      }
    };
    posicionar();
    requestAnimationFrame(posicionar);
  }

  function renderMensagens(mensagens) {
    const container = el('chat-mensagens');
    if (!mensagens.length) {
      container.innerHTML = telefoneAtivo
        ? '<p class="msg-vazia">Nenhuma mensagem nesta sessão. As mensagens não são armazenadas.</p>'
        : '<p class="msg-vazia">Nenhuma mensagem encontrada para este número.</p>';
      return;
    }

    container.innerHTML = mensagens.map((mensagem) => buildBolhaHtml(mensagem)).join('');
    if (paginaMensagens === 1) {
      rolarAteUltimaMensagem();
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

  el('monitor-atualizar').addEventListener('click', carregarMonitoramento);
  el('monitor-eventos-toggle').addEventListener('click', alternarDetalhesMonitor);
  setInterval(carregarMonitoramento, 15000);
  carregarMonitoramento();

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
