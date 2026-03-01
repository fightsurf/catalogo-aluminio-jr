/* =========================================================
   prestacao.js – Prestação de Contas frontend
   Nunca calcula valores financeiros; apenas exibe dados da API.
   ========================================================= */

const API_BASE = '/api/prestacoes';

let prestacaoAtualId = null;

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
    const res = await fetch(API_BASE);
    const json = await res.json();
    if (!json.success) throw new Error(json.message);
    const sel = document.getElementById('sel-prestacao');
    const anteriorId = prestacaoAtualId;
    sel.innerHTML = '<option value="">-- selecione --</option>';
    json.data.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = `#${p.id} – ${p.titulo} (${fmtData(p.data_referencia)})`;
      sel.appendChild(opt);
    });
    if (anteriorId) {
      sel.value = anteriorId;
    }
  } catch (e) {
    console.error('Erro ao carregar lista:', e);
  }
}

// ─── CARREGAR RESUMO DA PRESTAÇÃO SELECIONADA ──────────────────

async function carregarResumo(id) {
  try {
    const res = await fetch(`${API_BASE}/${id}/resumo`);
    const json = await res.json();
    if (!json.success) throw new Error(json.message);
    renderizarPlanilha(json.data);
    document.getElementById('planilha-container').style.display = 'block';
  } catch (e) {
    console.error('Erro ao carregar resumo:', e);
    showMsg('Erro ao carregar prestação: ' + e.message, 'erro');
  }
}

// ─── RENDERIZAR PLANILHA ───────────────────────────────────────

function renderizarPlanilha(resumo) {
  const { cabecalho, materiais, pagamentos, totais } = resumo;

  // Faixa título
  const titulo = cabecalho
    ? `PRESTAÇÃO DE CONTAS – ${cabecalho.titulo} ${fmtData(cabecalho.data_referencia)}`
    : 'PRESTAÇÃO DE CONTAS';
  document.getElementById('faixa-titulo').textContent = titulo;

  // Tabela materiais
  const tbodyMat = document.getElementById('tbody-materiais');
  tbodyMat.innerHTML = '';
  materiais.forEach(item => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${item.material}</td>
      <td class="num">${fmtPeso(item.peso_kg)}</td>
      <td class="num">${fmtMoeda(item.preco_por_kg)}</td>
      <td class="num">${fmtMoeda(item.total_item)}</td>
      <td style="text-align:center;"><button class="btn-del" data-id="${item.id}">✕</button></td>
    `;
    tr.querySelector('.btn-del').addEventListener('click', () => deletarItem(item.id));
    tbodyMat.appendChild(tr);
  });
  document.getElementById('total-peso').textContent = fmtPeso(totais.peso_total);
  document.getElementById('total-material').textContent = 'R$ ' + fmtMoeda(totais.total_material);

  // Tabela pagamentos
  const tbodyPag = document.getElementById('tbody-pagamentos');
  tbodyPag.innerHTML = '';
  pagamentos.forEach(pag => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${fmtData(pag.data)}</td>
      <td class="num">${fmtMoeda(pag.valor)}</td>
      <td>${pag.observacao || ''}</td>
      <td style="text-align:center;"><button class="btn-del" data-id="${pag.id}">✕</button></td>
    `;
    tr.querySelector('.btn-del').addEventListener('click', () => deletarPagamento(pag.id));
    tbodyPag.appendChild(tr);
  });
  document.getElementById('total-pago').textContent = 'R$ ' + fmtMoeda(totais.total_pago);
  document.getElementById('saldo-restante').textContent = 'R$ ' + fmtMoeda(totais.saldo_restante);
}

// ─── NOVA PRESTAÇÃO – ABRIR/FECHAR FORMULÁRIO ──────────────────

document.getElementById('btn-nova').addEventListener('click', () => {
  const form = document.getElementById('form-nova');
  form.style.display = form.style.display === 'none' ? 'flex' : 'none';
});

document.getElementById('btn-cancelar-nova').addEventListener('click', () => {
  document.getElementById('form-nova').style.display = 'none';
  document.getElementById('nova-titulo').value = '';
  document.getElementById('nova-data').value = '';
});

document.getElementById('btn-confirmar-nova').addEventListener('click', async () => {
  const titulo = document.getElementById('nova-titulo').value.trim();
  const dataRef = document.getElementById('nova-data').value;
  if (!titulo || !dataRef) {
    showMsg('Preencha o título e a data de referência.', 'erro');
    return;
  }

  try {
    const res = await fetch(API_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ titulo, data_referencia: dataRef })
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.message);
    prestacaoAtualId = json.data.id;
    document.getElementById('form-nova').style.display = 'none';
    document.getElementById('nova-titulo').value = '';
    document.getElementById('nova-data').value = '';
    await carregarLista();
    document.getElementById('sel-prestacao').value = prestacaoAtualId;
    await carregarResumo(prestacaoAtualId);
    showMsg('Prestação criada com sucesso!', 'sucesso');
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
    document.getElementById('planilha-container').style.display = 'none';
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

async function deletarItem(itemId) {
  if (!confirm('Remover este item?')) return;
  try {
    const res = await fetch(`${API_BASE}/${prestacaoAtualId}/itens/${itemId}`, { method: 'DELETE' });
    const json = await res.json();
    if (!json.success) throw new Error(json.message);
    await carregarResumo(prestacaoAtualId);
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

// ─── DELETAR PAGAMENTO ─────────────────────────────────────────

async function deletarPagamento(pagamentoId) {
  if (!confirm('Remover este pagamento?')) return;
  try {
    const res = await fetch(`${API_BASE}/${prestacaoAtualId}/pagamentos/${pagamentoId}`, { method: 'DELETE' });
    const json = await res.json();
    if (!json.success) throw new Error(json.message);
    await carregarResumo(prestacaoAtualId);
  } catch (e) {
    console.error('Erro ao deletar pagamento:', e);
    showMsg('Erro ao remover pagamento: ' + e.message, 'erro');
  }
}

// ─── BOTÃO WHATSAPP (PLACEHOLDER) ─────────────────────────────

document.getElementById('btn-whatsapp').addEventListener('click', () => {
  console.log('Gerar imagem');
});

// ─── INIT ──────────────────────────────────────────────────────

carregarLista();
