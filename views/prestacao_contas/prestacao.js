/* =========================================================
   prestacao.js – Prestação de Contas frontend
   Nunca calcula valores financeiros; apenas exibe dados da API.
   ========================================================= */

const API_BASE = '/api/prestacoes';

let prestacaoAtualId = null;
let prestacaoAtualResumo = null;
let todasPrestacoes = [];

// ─── FORMAT HELPERS ────────────────────────────────────────────

function fmtMoeda(v) {
  return parseFloat(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtPeso(v) {
  return parseFloat(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

function fmtData(v) {
  if (!v) return '';
  const parts = v.toString().substring(0, 10).split('-');
  if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
  return v;
}


function fmtMoedaRelatorio(v) {
  return 'R$ ' + fmtMoeda(v);
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function textoOuTraco(value) {
  const texto = String(value == null ? '' : value).trim();
  return texto ? texto : '—';
}

function dataHoraAtualBR() {
  return new Date().toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}


function statusPrestacao(prestacao) {
  return String((prestacao && prestacao.status) || 'ABERTA').toUpperCase();
}

function labelStatus(status) {
  const s = String(status || 'ABERTA').toUpperCase();
  if (s === 'CONCLUIDA') return 'CONCLUÍDA';
  return 'ABERTA';
}

function filtroStatusAtual() {
  const el = document.getElementById('filtro-status');
  return el ? el.value || 'ABERTA' : 'ABERTA';
}

function isConcluida(prestacao) {
  return statusPrestacao(prestacao) === 'CONCLUIDA';
}

function setElementDisplay(id, visible, displayValue) {
  const el = document.getElementById(id);
  if (el) el.style.display = visible ? (displayValue || '') : 'none';
}

// ─── FEEDBACK ──────────────────────────────────────────────────

function showMsg(msg, tipo) {
  const el = document.getElementById('msg-feedback');
  el.textContent = msg;
  el.className = 'msg-feedback ' + (tipo || 'sucesso');
  el.style.display = 'block';
  clearTimeout(el._timer);
  el._timer = setTimeout(() => { el.style.display = 'none'; }, 5000);
}

// ─── CARREGAR LISTA DE PRESTAÇÕES ──────────────────────────────

async function carregarLista() {
  try {
    const status = filtroStatusAtual();
    const res = await fetch(`${API_BASE}?status=${encodeURIComponent(status)}`);
    const json = await res.json();
    if (!json.success) throw new Error(json.message);
    todasPrestacoes = json.data || [];
    const sel = document.getElementById('sel-prestacao');
    const anteriorId = prestacaoAtualId;
    sel.innerHTML = '<option value="">-- selecione --</option>';
    todasPrestacoes.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = `#${p.id} – ${p.titulo} (${fmtData(p.data_referencia)})`;
      sel.appendChild(opt);
    });
    if (anteriorId && todasPrestacoes.some(p => String(p.id) === String(anteriorId))) {
      sel.value = anteriorId;
    } else if (anteriorId) {
      prestacaoAtualId = null;
      prestacaoAtualResumo = null;
      _mostrarEmptyState();
    }
    renderizarGrid();
  } catch (e) {
    console.error('Erro ao carregar lista:', e);
    showMsg('Erro ao carregar prestações: ' + e.message, 'erro');
  }
}

// ─── RENDERIZAR GRID DE PRESTAÇÕES ────────────────────────────

function renderizarGrid() {
  const filtroId = document.getElementById('filtro-fornecedor').value;
  const lista = filtroId
    ? todasPrestacoes.filter(p => String(p.fornecedor_id) === String(filtroId))
    : todasPrestacoes;
  const tbody = document.getElementById('tbody-lista');
  tbody.innerHTML = '';
  if (!lista.length) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td colspan="6" class="msg-vazio">Nenhuma prestação encontrada.</td>';
    tbody.appendChild(tr);
    return;
  }
  lista.forEach(p => {
    const tr = document.createElement('tr');
    const concluida = isConcluida(p);
    if (prestacaoAtualId && String(p.id) === String(prestacaoAtualId)) {
      tr.classList.add('linha-ativa');
    }
    tr.innerHTML = `
      <td>${escapeHtml(p.id)}</td>
      <td>${escapeHtml(p.titulo)}</td>
      <td>${escapeHtml(fmtData(p.data_referencia))}</td>
      <td>${escapeHtml(p.fornecedor_nome || '—')}</td>
      <td><span class="status-badge ${concluida ? 'status-concluida' : 'status-aberta'}">${labelStatus(p.status)}</span></td>
      <td style="text-align:center; white-space:nowrap;">
        <button class="btn-selecionar">Abrir</button>
        ${concluida ? '' : '<button class="btn-del btn-del-lista">✕</button>'}
      </td>
    `;
    tr.querySelector('.btn-selecionar').addEventListener('click', () => selecionarPrestacao(p.id));
    const btnDel = tr.querySelector('.btn-del-lista');
    if (btnDel) btnDel.addEventListener('click', (e) => deletarPrestacao(p.id, e.currentTarget));
    tbody.appendChild(tr);
  });
}

function _mostrarPlanilha() {
  const empty = document.getElementById('empty-state');
  if (empty) empty.style.display = 'none';
  document.getElementById('planilha-container').style.display = 'block';
}

function _mostrarEmptyState() {
  prestacaoAtualResumo = null;
  document.getElementById('planilha-container').style.display = 'none';
  const empty = document.getElementById('empty-state');
  if (empty) empty.style.display = '';
  const subtitle = document.getElementById('prestacao-ativa-subtitle');
  if (subtitle) subtitle.textContent = '';
}

async function selecionarPrestacao(id) {
  prestacaoAtualId = id;
  document.getElementById('sel-prestacao').value = id;
  renderizarGrid();
  await carregarResumo(id);
  document.getElementById('planilha-container').scrollIntoView({ behavior: 'smooth' });
}

// ─── CARREGAR RESUMO DA PRESTAÇÃO SELECIONADA ──────────────────

async function carregarResumo(id) {
  try {
    const res = await fetch(`${API_BASE}/${id}/resumo`);
    const json = await res.json();
    if (!json.success) throw new Error(json.message);
    renderizarPlanilha(json.data);
    _mostrarPlanilha();
  } catch (e) {
    console.error('Erro ao carregar resumo:', e);
    showMsg('Erro ao carregar prestação: ' + e.message, 'erro');
  }
}

// ─── RENDERIZAR PLANILHA ───────────────────────────────────────

function renderizarPlanilha(resumo) {
  prestacaoAtualResumo = resumo;
  const { cabecalho, materiais, pagamentos, totais, creditos_origem, creditos_destino } = resumo;
  const concluida = isConcluida(cabecalho);

  // Faixa título
  const dataFmt = cabecalho ? fmtData(cabecalho.data_referencia) : '';
  const tituloMateriais = cabecalho
    ? `PRESTAÇÃO DE CONTAS - COLETA MATERIAL ${dataFmt}`
    : 'PRESTAÇÃO DE CONTAS';
  const tituloMat = document.getElementById('faixa-titulo');
  if (tituloMat) tituloMat.textContent = tituloMateriais;
  const tituloPag = document.getElementById('faixa-pagamentos');
  if (tituloPag) tituloPag.textContent = cabecalho
    ? `PRESTAÇÃO DE CONTAS - PAGAMENTOS DA COLETA ${dataFmt}`
    : 'PAGAMENTOS';
  const subtitle = document.getElementById('prestacao-ativa-subtitle');
  if (subtitle) subtitle.textContent = cabecalho ? `${cabecalho.titulo} – ${fmtData(cabecalho.data_referencia)} – ${labelStatus(cabecalho.status)}` : '';

  const badge = document.getElementById('status-prestacao-badge');
  if (badge) {
    badge.textContent = labelStatus(cabecalho && cabecalho.status);
    badge.className = `status-badge ${concluida ? 'status-concluida' : 'status-aberta'}`;
  }

  setElementDisplay('btn-concluir-prestacao', !concluida);
  setElementDisplay('btn-reabrir-prestacao', concluida);
  setElementDisplay('btn-alterar-prestacao', !concluida);
  setElementDisplay('btn-excluir-prestacao', !concluida);
  setElementDisplay('btn-whatsapp-resumo', !concluida);
  setElementDisplay('btn-whatsapp-pdf', !concluida);
  setElementDisplay('form-item', !concluida, 'flex');
  setElementDisplay('form-pagamento', !concluida, 'flex');
  setElementDisplay('form-editar-prestacao', false);

  const creditoInfo = document.getElementById('credito-info');
  if (creditoInfo) {
    const creditosOrigem = creditos_origem || [];
    const creditosDestino = creditos_destino || [];
    const partes = [];
    creditosOrigem.forEach(c => partes.push(`Crédito gerado: R$ ${fmtMoeda(c.valor)} (${c.status})`));
    creditosDestino.forEach(c => partes.push(`Crédito recebido da prestação #${c.prestacao_origem_id}: R$ ${fmtMoeda(c.valor)}`));
    creditoInfo.textContent = partes.join(' • ');
    creditoInfo.style.display = partes.length ? '' : 'none';
  }

  // Tabela materiais
  const tbodyMat = document.getElementById('tbody-materiais');
  tbodyMat.innerHTML = '';
  materiais.forEach(item => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(item.descricao_material)}</td>
      <td class="num">${escapeHtml(fmtPeso(item.peso_kg))}</td>
      <td class="num">${escapeHtml(fmtMoeda(item.preco_por_kg))}</td>
      <td class="num">${escapeHtml(fmtMoeda(item.total_item))}</td>
      <td style="text-align:center;">${concluida ? '' : `<button class="btn-del" data-id="${escapeHtml(item.id)}">✕</button>`}</td>
    `;
    const btnDel = tr.querySelector('.btn-del');
    if (btnDel) btnDel.addEventListener('click', (e) => deletarItem(item.id, e.currentTarget));
    tbodyMat.appendChild(tr);
  });
  document.getElementById('total-peso').textContent = fmtPeso(totais.peso_total);
  document.getElementById('total-material').textContent = 'R$ ' + fmtMoeda(totais.total_material);

  // Tabela pagamentos
  const tbodyPag = document.getElementById('tbody-pagamentos');
  tbodyPag.innerHTML = '';
  pagamentos.forEach(pag => {
    const tr = document.createElement('tr');
    const automatico = pag.credito_origem_id ? '<span class="tag-credito">crédito</span>' : '';
    tr.innerHTML = `
      <td>${escapeHtml(fmtData(pag.data_pagamento))}</td>
      <td class="num">R$ ${escapeHtml(fmtMoeda(pag.valor))}</td>
      <td>${escapeHtml(pag.observacao || '')} ${automatico}</td>
      <td style="text-align:center;">${concluida ? '' : `<button class="btn-del" data-id="${escapeHtml(pag.id)}">✕</button>`}</td>
    `;
    const btnDel = tr.querySelector('.btn-del');
    if (btnDel) btnDel.addEventListener('click', (e) => deletarPagamento(pag.id, e.currentTarget));
    tbodyPag.appendChild(tr);
  });
  document.getElementById('total-pago').textContent = 'R$ ' + fmtMoeda(totais.total_pago);
  document.getElementById('saldo-restante').textContent = 'R$ ' + fmtMoeda(totais.saldo_restante);
}

// ─── CARREGAR FORNECEDORES ─────────────────────────────────────

async function carregarFornecedores() {
  try {
    const res = await fetch('/api/fornecedores');
    const lista = await res.json();
    const sel = document.getElementById('nova-fornecedor');
    sel.innerHTML = '<option value="">-- selecione --</option>';
    lista.forEach(f => {
      const opt = document.createElement('option');
      opt.value = f.id;
      opt.textContent = f.nome;
      sel.appendChild(opt);
    });
    const editar = document.getElementById('editar-fornecedor');
    if (editar) {
      const editarAnterior = editar.value;
      editar.innerHTML = '<option value="">-- selecione --</option>';
      lista.forEach(f => {
        const opt = document.createElement('option');
        opt.value = f.id;
        opt.textContent = f.nome;
        editar.appendChild(opt);
      });
      if (editarAnterior) editar.value = editarAnterior;
    }
    // Also populate the grid filter
    const filtro = document.getElementById('filtro-fornecedor');
    const filtroAnterior = filtro.value;
    filtro.innerHTML = '<option value="">Todos</option>';
    lista.forEach(f => {
      const opt = document.createElement('option');
      opt.value = f.id;
      opt.textContent = f.nome;
      filtro.appendChild(opt);
    });
    if (filtroAnterior) filtro.value = filtroAnterior;
  } catch (e) {
    console.error('Erro ao carregar fornecedores:', e);
  }
}

document.getElementById('filtro-fornecedor').addEventListener('change', renderizarGrid);
document.getElementById('filtro-status').addEventListener('change', async () => {
  prestacaoAtualId = null;
  prestacaoAtualResumo = null;
  _mostrarEmptyState();
  await carregarLista();
});

// ─── NOVA PRESTAÇÃO – ABRIR/FECHAR FORMULÁRIO ──────────────────

document.getElementById('btn-nova').addEventListener('click', () => {
  const form = document.getElementById('form-nova');
  const isHidden = form.style.display === 'none';
  form.style.display = isHidden ? 'flex' : 'none';
  if (isHidden) carregarFornecedores();
});

document.getElementById('btn-cancelar-nova').addEventListener('click', () => {
  document.getElementById('form-nova').style.display = 'none';
  document.getElementById('nova-titulo').value = '';
  document.getElementById('nova-data').value = '';
  document.getElementById('nova-fornecedor').value = '';
});

// ─── ALTERAR PRESTAÇÃO ─────────────────────────────────────────

function fecharEdicaoPrestacao() {
  const form = document.getElementById('form-editar-prestacao');
  if (form) form.style.display = 'none';
}

function abrirEdicaoPrestacao() {
  if (!prestacaoAtualId || !prestacaoAtualResumo || !prestacaoAtualResumo.cabecalho) {
    showMsg('Abra uma prestação antes de alterar.', 'erro');
    return;
  }

  const cabecalho = prestacaoAtualResumo.cabecalho;
  if (isConcluida(cabecalho)) {
    showMsg('Prestação concluída não pode ser alterada.', 'erro');
    return;
  }

  document.getElementById('editar-titulo').value = cabecalho.titulo || '';
  document.getElementById('editar-data').value = cabecalho.data_referencia
    ? String(cabecalho.data_referencia).substring(0, 10)
    : '';
  document.getElementById('editar-fornecedor').value = cabecalho.fornecedor_id || '';

  const form = document.getElementById('form-editar-prestacao');
  form.style.display = 'flex';
  document.getElementById('editar-titulo').focus();
}

const btnAlterarPrestacao = document.getElementById('btn-alterar-prestacao');
if (btnAlterarPrestacao) {
  btnAlterarPrestacao.addEventListener('click', abrirEdicaoPrestacao);
}

const btnCancelarAlteracaoPrestacao = document.getElementById('btn-cancelar-alteracao-prestacao');
if (btnCancelarAlteracaoPrestacao) {
  btnCancelarAlteracaoPrestacao.addEventListener('click', fecharEdicaoPrestacao);
}

const btnSalvarAlteracaoPrestacao = document.getElementById('btn-salvar-alteracao-prestacao');
if (btnSalvarAlteracaoPrestacao) {
  btnSalvarAlteracaoPrestacao.addEventListener('click', async () => {
    if (!prestacaoAtualId) {
      showMsg('Abra uma prestação antes de alterar.', 'erro');
      return;
    }

    const titulo = document.getElementById('editar-titulo').value.trim();
    const data_referencia = document.getElementById('editar-data').value;
    const fornecedor_id = document.getElementById('editar-fornecedor').value;

    if (!titulo || !data_referencia || !fornecedor_id) {
      showMsg('Preencha título, data de referência e fornecedor.', 'erro');
      return;
    }

    const btn = btnSalvarAlteracaoPrestacao;
    const textoOriginal = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Salvando...';

    try {
      const res = await fetch(`${API_BASE}/${prestacaoAtualId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ titulo, data_referencia, fornecedor_id })
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.message);

      fecharEdicaoPrestacao();
      await carregarLista();
      await carregarResumo(prestacaoAtualId);
      showMsg('Informações da prestação alteradas com sucesso!', 'sucesso');
    } catch (e) {
      console.error('Erro ao alterar prestação:', e);
      showMsg('Erro ao alterar prestação: ' + e.message, 'erro');
    } finally {
      btn.disabled = false;
      btn.textContent = textoOriginal;
    }
  });
}

document.getElementById('btn-confirmar-nova').addEventListener('click', async () => {
  const titulo = document.getElementById('nova-titulo').value.trim();
  const dataRef = document.getElementById('nova-data').value;
  const fornecedor_id = document.getElementById('nova-fornecedor').value;
  if (!titulo || !dataRef) {
    showMsg('Preencha o título e a data de referência.', 'erro');
    return;
  }
  if (!fornecedor_id) {
    showMsg('Selecione um fornecedor.', 'erro');
    return;
  }

  try {
    const res = await fetch(API_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ titulo, data_referencia: dataRef, fornecedor_id })
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.message);
    prestacaoAtualId = json.data.id;
    document.getElementById('form-nova').style.display = 'none';
    document.getElementById('nova-titulo').value = '';
    document.getElementById('nova-data').value = '';
    document.getElementById('nova-fornecedor').value = '';
    document.getElementById('filtro-status').value = 'ABERTA';
    await carregarLista();
    document.getElementById('sel-prestacao').value = prestacaoAtualId;
    await carregarResumo(prestacaoAtualId);
    const creditos = Array.isArray(json.data.creditos_aplicados) ? json.data.creditos_aplicados : [];
    const extra = creditos.length ? ` Crédito anterior aplicado automaticamente: R$ ${fmtMoeda(creditos.reduce((acc, c) => acc + parseFloat(c.valor || 0), 0))}.` : '';
    showMsg('Prestação criada com sucesso!' + extra, 'sucesso');
  } catch (e) {
    console.error('Erro ao criar prestação:', e);
    showMsg('Erro ao criar prestação: ' + e.message, 'erro');
  }
});

// ─── SELECIONAR PRESTAÇÃO ──────────────────────────────────────

document.getElementById('sel-prestacao').addEventListener('change', async (e) => {
  const id = e.target.value;
  if (!id) {
    prestacaoAtualId = null;
    _mostrarEmptyState();
    return;
  }
  prestacaoAtualId = id;
  await carregarResumo(id);
});

// ─── ADICIONAR ITEM ────────────────────────────────────────────

document.getElementById('btn-add-item').addEventListener('click', async () => {
  if (!prestacaoAtualId) {
    showMsg('Selecione uma prestação primeiro.', 'erro');
    return;
  }
  const material = document.getElementById('item-material').value.trim();
  const peso_kg = document.getElementById('item-peso').value;
  const preco_por_kg = document.getElementById('item-preco').value;
  if (!material || !peso_kg || !preco_por_kg) {
    showMsg('Preencha todos os campos do item.', 'erro');
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/${prestacaoAtualId}/itens`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ material, peso_kg, preco_por_kg })
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.message);
    document.getElementById('item-material').value = '';
    document.getElementById('item-peso').value = '';
    document.getElementById('item-preco').value = '';
    await carregarResumo(prestacaoAtualId);
    showMsg('Item adicionado com sucesso!', 'sucesso');
  } catch (e) {
    console.error('Erro ao adicionar item:', e);
    showMsg('Erro ao adicionar item: ' + e.message, 'erro');
  }
});

// ─── DELETAR ITEM ──────────────────────────────────────────────

const _btnTimers = new WeakMap();

async function deletarItem(itemId, btn) {
  if (!btn.dataset.confirming) {
    btn.dataset.confirming = '1';
    const orig = btn.textContent;
    btn.textContent = 'Confirmar?';
    btn.style.background = '#c70';
    _btnTimers.set(btn, setTimeout(() => {
      delete btn.dataset.confirming;
      btn.textContent = orig;
      btn.style.background = '';
    }, 3000));
    return;
  }
  clearTimeout(_btnTimers.get(btn));
  _btnTimers.delete(btn);
  try {
    const res = await fetch(`${API_BASE}/${prestacaoAtualId}/itens/${itemId}`, { method: 'DELETE' });
    const json = await res.json();
    if (!json.success) throw new Error(json.message);
    await carregarResumo(prestacaoAtualId);
    showMsg('Item removido.', 'sucesso');
  } catch (e) {
    console.error('Erro ao deletar item:', e);
    showMsg('Erro ao remover item: ' + e.message, 'erro');
  }
}

// ─── ADICIONAR PAGAMENTO ───────────────────────────────────────

document.getElementById('btn-add-pag').addEventListener('click', async () => {
  if (!prestacaoAtualId) {
    showMsg('Selecione uma prestação primeiro.', 'erro');
    return;
  }
  const data = document.getElementById('pag-data').value;
  const valor = document.getElementById('pag-valor').value;
  const observacao = document.getElementById('pag-obs').value.trim();
  if (!data || !valor) {
    showMsg('Preencha data e valor do pagamento.', 'erro');
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/${prestacaoAtualId}/pagamentos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data, valor, observacao })
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.message);
    document.getElementById('pag-data').value = '';
    document.getElementById('pag-valor').value = '';
    document.getElementById('pag-obs').value = '';
    await carregarResumo(prestacaoAtualId);
    showMsg('Pagamento adicionado com sucesso!', 'sucesso');
  } catch (e) {
    console.error('Erro ao adicionar pagamento:', e);
    showMsg('Erro ao adicionar pagamento: ' + e.message, 'erro');
  }
});

// ─── DELETAR PRESTAÇÃO ────────────────────────────────────────

async function deletarPrestacao(id, btn) {
  if (!btn.dataset.confirming) {
    btn.dataset.confirming = '1';
    const orig = btn.textContent;
    btn.textContent = 'Confirmar?';
    btn.style.background = '#c70';
    _btnTimers.set(btn, setTimeout(() => {
      delete btn.dataset.confirming;
      btn.textContent = orig;
      btn.style.background = '';
    }, 3000));
    return;
  }
  clearTimeout(_btnTimers.get(btn));
  _btnTimers.delete(btn);
  try {
    const res = await fetch(`${API_BASE}/${id}`, { method: 'DELETE' });
    const json = await res.json();
    if (!json.success) throw new Error(json.message);
    if (String(prestacaoAtualId) === String(id)) {
      prestacaoAtualId = null;
      _mostrarEmptyState();
    }
    await carregarLista();
    showMsg('Prestação excluída.', 'sucesso');
  } catch (e) {
    console.error('Erro ao deletar prestação:', e);
    showMsg('Erro ao excluir prestação: ' + e.message, 'erro');
  }
}

const btnExcluirPrestacao = document.getElementById('btn-excluir-prestacao');
if (btnExcluirPrestacao) {
  btnExcluirPrestacao.addEventListener('click', (e) => {
    if (prestacaoAtualId) deletarPrestacao(prestacaoAtualId, e.currentTarget);
  });
}

// ─── DELETAR PAGAMENTO ─────────────────────────────────────────

async function deletarPagamento(pagamentoId, btn) {
  if (!btn.dataset.confirming) {
    btn.dataset.confirming = '1';
    const orig = btn.textContent;
    btn.textContent = 'Confirmar?';
    btn.style.background = '#c70';
    _btnTimers.set(btn, setTimeout(() => {
      delete btn.dataset.confirming;
      btn.textContent = orig;
      btn.style.background = '';
    }, 3000));
    return;
  }
  clearTimeout(_btnTimers.get(btn));
  _btnTimers.delete(btn);
  try {
    const res = await fetch(`${API_BASE}/${prestacaoAtualId}/pagamentos/${pagamentoId}`, { method: 'DELETE' });
    const json = await res.json();
    if (!json.success) throw new Error(json.message);
    await carregarResumo(prestacaoAtualId);
    showMsg('Pagamento removido.', 'sucesso');
  } catch (e) {
    console.error('Erro ao deletar pagamento:', e);
    showMsg('Erro ao remover pagamento: ' + e.message, 'erro');
  }
}


// ─── ENVIAR RESUMO POR WHATSAPP ─────────────────────────────────

async function enviarResumoWhatsappPrestacao(btn) {
  if (!prestacaoAtualId) {
    showMsg('Abra uma prestação antes de enviar o resumo.', 'erro');
    return;
  }

  const textoOriginal = btn.textContent;
  try {
    btn.disabled = true;
    btn.textContent = 'Enviando...';

    const res = await fetch(`${API_BASE}/${prestacaoAtualId}/whatsapp/resumo`, {
      method: 'POST'
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.message || 'Erro ao enviar resumo pelo WhatsApp.');

    const quantidade = Number(json.data && json.data.quantidade_pagamentos || 0);
    showMsg(`Resumo enviado ao fornecedor com ${quantidade} pagamento(s).`, 'sucesso');
  } catch (e) {
    console.error('Erro ao enviar resumo da prestação:', e);
    showMsg('Erro ao enviar resumo: ' + e.message, 'erro');
  } finally {
    btn.disabled = false;
    btn.textContent = textoOriginal;
  }
}

const btnWhatsappResumo = document.getElementById('btn-whatsapp-resumo');
if (btnWhatsappResumo) {
  btnWhatsappResumo.addEventListener('click', (e) => enviarResumoWhatsappPrestacao(e.currentTarget));
}

// ─── ENVIAR PDF POR WHATSAPP ────────────────────────────────────

async function enviarPdfWhatsappPrestacao(btn) {
  if (!prestacaoAtualId) {
    showMsg('Abra uma prestação antes de enviar o PDF.', 'erro');
    return;
  }

  const textoOriginal = btn.textContent;
  try {
    btn.disabled = true;
    btn.textContent = 'Enviando PDF...';

    const res = await fetch(`${API_BASE}/${prestacaoAtualId}/whatsapp/pdf`, {
      method: 'POST'
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.message || 'Erro ao enviar PDF pelo WhatsApp.');

    showMsg(`PDF enviado ao WhatsApp do fornecedor. Arquivo: ${json.data.nome_arquivo}`, 'sucesso');
  } catch (e) {
    console.error('Erro ao enviar PDF da prestação:', e);
    showMsg('Erro ao enviar PDF: ' + e.message, 'erro');
  } finally {
    btn.disabled = false;
    btn.textContent = textoOriginal;
  }
}

const btnWhatsappPdf = document.getElementById('btn-whatsapp-pdf');
if (btnWhatsappPdf) {
  btnWhatsappPdf.addEventListener('click', (e) => enviarPdfWhatsappPrestacao(e.currentTarget));
}

// ─── CONCLUIR / REABRIR PRESTAÇÃO ──────────────────────────────

async function concluirPrestacao(btn) {
  if (!prestacaoAtualId) {
    showMsg('Abra uma prestação antes de concluir.', 'erro');
    return;
  }
  if (!btn.dataset.confirming) {
    btn.dataset.confirming = '1';
    const orig = btn.textContent;
    btn.textContent = 'Confirmar conclusão?';
    _btnTimers.set(btn, setTimeout(() => {
      delete btn.dataset.confirming;
      btn.textContent = orig;
    }, 3500));
    return;
  }
  clearTimeout(_btnTimers.get(btn));
  _btnTimers.delete(btn);

  try {
    const res = await fetch(`${API_BASE}/${prestacaoAtualId}/concluir`, { method: 'PATCH' });
    const json = await res.json();
    if (!json.success) throw new Error(json.message);

    const credito = json.data && json.data.credito_gerado;
    const msgCredito = credito ? ` Crédito gerado para a próxima prestação: R$ ${fmtMoeda(credito.valor)}.` : '';
    prestacaoAtualId = null;
    prestacaoAtualResumo = null;
    _mostrarEmptyState();
    await carregarLista();
    showMsg('Prestação concluída e arquivada.' + msgCredito, 'sucesso');
  } catch (e) {
    console.error('Erro ao concluir prestação:', e);
    showMsg('Erro ao concluir prestação: ' + e.message, 'erro');
  } finally {
    delete btn.dataset.confirming;
    btn.textContent = '✅ Concluir';
  }
}

async function reabrirPrestacao(btn) {
  if (!prestacaoAtualId) {
    showMsg('Abra uma prestação antes de reabrir.', 'erro');
    return;
  }
  if (!btn.dataset.confirming) {
    btn.dataset.confirming = '1';
    const orig = btn.textContent;
    btn.textContent = 'Confirmar reabertura?';
    _btnTimers.set(btn, setTimeout(() => {
      delete btn.dataset.confirming;
      btn.textContent = orig;
    }, 3500));
    return;
  }
  clearTimeout(_btnTimers.get(btn));
  _btnTimers.delete(btn);

  try {
    const res = await fetch(`${API_BASE}/${prestacaoAtualId}/reabrir`, { method: 'PATCH' });
    const json = await res.json();
    if (!json.success) throw new Error(json.message);

    document.getElementById('filtro-status').value = 'ABERTA';
    await carregarLista();
    prestacaoAtualId = json.data.id;
    document.getElementById('sel-prestacao').value = prestacaoAtualId;
    await carregarResumo(prestacaoAtualId);
    showMsg('Prestação reaberta.', 'sucesso');
  } catch (e) {
    console.error('Erro ao reabrir prestação:', e);
    showMsg('Erro ao reabrir prestação: ' + e.message, 'erro');
  } finally {
    delete btn.dataset.confirming;
    btn.textContent = '↩ Reabrir';
  }
}

const btnConcluirPrestacao = document.getElementById('btn-concluir-prestacao');
if (btnConcluirPrestacao) {
  btnConcluirPrestacao.addEventListener('click', (e) => concluirPrestacao(e.currentTarget));
}

const btnReabrirPrestacao = document.getElementById('btn-reabrir-prestacao');
if (btnReabrirPrestacao) {
  btnReabrirPrestacao.addEventListener('click', (e) => reabrirPrestacao(e.currentTarget));
}


// ─── RELATÓRIO PDF DA PRESTAÇÃO ABERTA ─────────────────────────

function abrirJanelaRelatorio() {
  const janela = window.open('', '_blank');
  if (!janela) {
    showMsg('O navegador bloqueou a janela do relatório. Libere pop-ups para este sistema.', 'erro');
    return null;
  }

  janela.document.open();
  janela.document.write(`
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
      <meta charset="UTF-8" />
      <title>Gerando relatório...</title>
      <style>
        body {
          margin: 0;
          padding: 32px;
          font-family: Arial, sans-serif;
          color: #24292f;
          background: #ffffff;
        }
        .loading {
          max-width: 720px;
          margin: 80px auto;
          padding: 24px;
          border: 1px solid #d0d7de;
          border-radius: 8px;
          background: #f6f8fa;
          text-align: center;
        }
        h1 { margin: 0 0 8px; font-size: 20px; }
        p { margin: 0; color: #57606a; }
      </style>
    </head>
    <body>
      <div class="loading">
        <h1>Gerando relatório...</h1>
        <p>Aguarde a prestação ser carregada.</p>
      </div>
    </body>
    </html>
  `);
  janela.document.close();
  return janela;
}

function montarLinhasMateriais(materiais) {
  if (!materiais || !materiais.length) {
    return '<tr><td colspan="4" class="vazio">Nenhum material lançado.</td></tr>';
  }

  return materiais.map(item => `
    <tr>
      <td>${escapeHtml(textoOuTraco(item.descricao_material))}</td>
      <td class="num">${escapeHtml(fmtPeso(item.peso_kg))}</td>
      <td class="num">${escapeHtml(fmtMoedaRelatorio(item.preco_por_kg))}</td>
      <td class="num">${escapeHtml(fmtMoedaRelatorio(item.total_item))}</td>
    </tr>
  `).join('');
}

function montarLinhasPagamentos(pagamentos) {
  if (!pagamentos || !pagamentos.length) {
    return '<tr><td colspan="3" class="vazio">Nenhum pagamento lançado.</td></tr>';
  }

  return pagamentos.map(pag => `
    <tr>
      <td>${escapeHtml(fmtData(pag.data_pagamento))}</td>
      <td>${escapeHtml(textoOuTraco(pag.observacao))}</td>
      <td class="num">${escapeHtml(fmtMoedaRelatorio(pag.valor))}</td>
    </tr>
  `).join('');
}

function montarHtmlRelatorio(resumo) {
  const cabecalho = resumo.cabecalho || {};
  const materiais = resumo.materiais || [];
  const pagamentos = resumo.pagamentos || [];
  const totais = resumo.totais || {};

  const titulo = textoOuTraco(cabecalho.titulo);
  const fornecedor = textoOuTraco(cabecalho.fornecedor_nome);
  const dataReferencia = fmtData(cabecalho.data_referencia) || '—';
  const status = textoOuTraco(cabecalho.status || 'Aberta');
  const observacao = textoOuTraco(cabecalho.observacao);
  const geradoEm = dataHoraAtualBR();

  return `
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
      <meta charset="UTF-8" />
      <title>Prestação ${escapeHtml(titulo)} - ${escapeHtml(fornecedor)}</title>
      <style>
        * { box-sizing: border-box; }
        body {
          margin: 0;
          padding: 24px;
          font-family: Arial, Helvetica, sans-serif;
          color: #24292f;
          background: #ffffff;
          font-size: 12px;
          line-height: 1.35;
        }
        .relatorio { max-width: 980px; margin: 0 auto; }
        .no-print { display: flex; justify-content: flex-end; gap: 8px; margin-bottom: 14px; }
        .btn-print { padding: 7px 12px; border: 1px solid #0969da; border-radius: 6px; background: #0969da; color: #fff; font-weight: 700; cursor: pointer; }
        .btn-close { padding: 7px 12px; border: 1px solid #d0d7de; border-radius: 6px; background: #fff; color: #24292f; font-weight: 600; cursor: pointer; }
        .header { display: flex; justify-content: space-between; gap: 20px; border-bottom: 2px solid #24292f; padding-bottom: 12px; margin-bottom: 14px; }
        .empresa { font-size: 18px; font-weight: 800; letter-spacing: .02em; }
        .titulo-relatorio { margin-top: 4px; font-size: 14px; font-weight: 700; text-transform: uppercase; }
        .gerado { text-align: right; color: #57606a; font-size: 11px; white-space: nowrap; }
        .info-grid { display: grid; grid-template-columns: repeat(4, 1fr); border: 1px solid #d0d7de; margin-bottom: 14px; }
        .info-item { padding: 8px 10px; border-right: 1px solid #d0d7de; border-bottom: 1px solid #d0d7de; min-height: 48px; }
        .info-item:nth-child(4n) { border-right: none; }
        .info-item.full { grid-column: 1 / -1; border-right: none; }
        .label { display: block; font-size: 10px; color: #57606a; text-transform: uppercase; font-weight: 700; margin-bottom: 3px; }
        .valor { display: block; font-size: 12px; font-weight: 700; }
        .secao { margin-top: 14px; page-break-inside: avoid; }
        .secao h2 { margin: 0; padding: 7px 9px; background: #f6f8fa; border: 1px solid #d0d7de; border-bottom: none; font-size: 12px; text-transform: uppercase; }
        table { width: 100%; border-collapse: collapse; font-size: 11.5px; }
        th, td { border: 1px solid #d0d7de; padding: 6px 8px; vertical-align: top; }
        th { background: #f6f8fa; color: #57606a; text-transform: uppercase; font-size: 10px; text-align: left; }
        .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
        .vazio { text-align: center; color: #57606a; font-style: italic; }
        tfoot td, tfoot th { background: #f6f8fa; font-weight: 800; }
        .resumo-final { margin-top: 16px; margin-left: auto; width: 360px; border: 1px solid #d0d7de; }
        .resumo-linha { display: flex; justify-content: space-between; gap: 12px; padding: 7px 10px; border-bottom: 1px solid #d0d7de; }
        .resumo-linha:last-child { border-bottom: none; }
        .resumo-linha.saldo { background: #f6f8fa; font-weight: 800; font-size: 13px; }
        .assinaturas { display: grid; grid-template-columns: 1fr 1fr; gap: 48px; margin-top: 56px; }
        .assinatura { border-top: 1px solid #24292f; text-align: center; padding-top: 6px; font-size: 11px; color: #57606a; }
        @page { size: A4; margin: 12mm; }
        @media print { body { padding: 0; } .no-print { display: none !important; } .relatorio { max-width: none; } .secao { page-break-inside: avoid; } }
        @media (max-width: 760px) { body { padding: 14px; } .header { flex-direction: column; } .gerado { text-align: left; } .info-grid { grid-template-columns: 1fr; } .info-item, .info-item:nth-child(4n) { border-right: none; } .resumo-final { width: 100%; } }
      </style>
    </head>
    <body>
      <div class="relatorio">
        <div class="no-print">
          <button class="btn-print" onclick="window.print()">Imprimir / Salvar PDF</button>
          <button class="btn-close" onclick="window.close()">Fechar</button>
        </div>
        <div class="header">
          <div>
            <div class="empresa">ALUMÍNIO JR</div>
            <div class="titulo-relatorio">Relatório de Prestação de Contas</div>
          </div>
          <div class="gerado">
            <div>Prestação #${escapeHtml(cabecalho.id || '')}</div>
            <div>Gerado em: ${escapeHtml(geradoEm)}</div>
          </div>
        </div>
        <div class="info-grid">
          <div class="info-item"><span class="label">Fornecedor</span><span class="valor">${escapeHtml(fornecedor)}</span></div>
          <div class="info-item"><span class="label">Prestação</span><span class="valor">${escapeHtml(titulo)}</span></div>
          <div class="info-item"><span class="label">Data referência</span><span class="valor">${escapeHtml(dataReferencia)}</span></div>
          <div class="info-item"><span class="label">Status</span><span class="valor">${escapeHtml(status)}</span></div>
          <div class="info-item full"><span class="label">Observação</span><span class="valor">${escapeHtml(observacao)}</span></div>
        </div>
        <div class="secao">
          <h2>Materiais lançados</h2>
          <table>
            <thead><tr><th>Material</th><th class="num">Peso (Kg)</th><th class="num">Preço/Kg</th><th class="num">Total</th></tr></thead>
            <tbody>${montarLinhasMateriais(materiais)}</tbody>
            <tfoot><tr><th>Total de materiais</th><td class="num">${escapeHtml(fmtPeso(totais.peso_total))}</td><td></td><td class="num">${escapeHtml(fmtMoedaRelatorio(totais.total_material))}</td></tr></tfoot>
          </table>
        </div>
        <div class="secao">
          <h2>Pagamentos lançados</h2>
          <table>
            <thead><tr><th>Data</th><th>Observação</th><th class="num">Valor</th></tr></thead>
            <tbody>${montarLinhasPagamentos(pagamentos)}</tbody>
            <tfoot><tr><th colspan="2">Total pago</th><td class="num">${escapeHtml(fmtMoedaRelatorio(totais.total_pago))}</td></tr></tfoot>
          </table>
        </div>
        <div class="resumo-final">
          <div class="resumo-linha"><span>Total material</span><strong>${escapeHtml(fmtMoedaRelatorio(totais.total_material))}</strong></div>
          <div class="resumo-linha"><span>Total pago</span><strong>${escapeHtml(fmtMoedaRelatorio(totais.total_pago))}</strong></div>
          <div class="resumo-linha saldo"><span>Saldo restante</span><strong>${escapeHtml(fmtMoedaRelatorio(totais.saldo_restante))}</strong></div>
        </div>
        <div class="assinaturas">
          <div class="assinatura">Alumínio JR</div>
          <div class="assinatura">Fornecedor</div>
        </div>
      </div>
      <script>
        window.addEventListener('load', function() {
          setTimeout(function() {
            window.focus();
            window.print();
          }, 350);
        });
      <\/script>
    </body>
    </html>
  `;
}

async function gerarRelatorioPdfPrestacao() {
  if (!prestacaoAtualId) {
    showMsg('Abra uma prestação antes de gerar o relatório.', 'erro');
    return;
  }

  const janela = abrirJanelaRelatorio();
  if (!janela) return;

  try {
    const res = await fetch(`${API_BASE}/${prestacaoAtualId}/resumo`);
    const json = await res.json();
    if (!json.success) throw new Error(json.message || 'Erro ao gerar relatório');

    janela.document.open();
    janela.document.write(montarHtmlRelatorio(json.data));
    janela.document.close();
  } catch (e) {
    console.error('Erro ao gerar relatório:', e);
    janela.document.open();
    janela.document.write(`
      <!DOCTYPE html>
      <html lang="pt-BR">
      <head><meta charset="UTF-8"><title>Erro no relatório</title></head>
      <body style="font-family: Arial, sans-serif; padding: 32px; color: #24292f;">
        <h1>Erro ao gerar relatório</h1>
        <p>${escapeHtml(e.message)}</p>
      </body>
      </html>
    `);
    janela.document.close();
    showMsg('Erro ao gerar relatório: ' + e.message, 'erro');
  }
}

const btnRelatorioPdf = document.getElementById('btn-relatorio-pdf');
if (btnRelatorioPdf) {
  btnRelatorioPdf.addEventListener('click', gerarRelatorioPdfPrestacao);
}

// ─── INIT ──────────────────────────────────────────────────────

async function inicializarPrestacaoContas() {
  await carregarFornecedores();

  // Evita que o navegador restaure automaticamente um fornecedor antigo
  // e dê a impressão de que as prestações desapareceram.
  const filtroFornecedor = document.getElementById('filtro-fornecedor');
  if (filtroFornecedor) filtroFornecedor.value = '';

  await carregarLista();

  const prestacaoDaUrl = new URLSearchParams(window.location.search).get('prestacao');
  if (prestacaoDaUrl && todasPrestacoes.some((p) => String(p.id) === String(prestacaoDaUrl))) {
    await selecionarPrestacao(prestacaoDaUrl);
  }
}

inicializarPrestacaoContas();
