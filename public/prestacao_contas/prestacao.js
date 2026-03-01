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
    alert('Erro ao carregar prestação: ' + e.message);
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

// ─── NOVA PRESTAÇÃO ────────────────────────────────────────────

document.getElementById('btn-nova').addEventListener('click', async () => {
  const titulo = prompt('Título da prestação:');
  if (!titulo) return;
  const dataRef = prompt('Data de referência (AAAA-MM-DD):');
  if (!dataRef) return;

  try {
    const res = await fetch(API_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ titulo, data_referencia: dataRef })
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.message);
    prestacaoAtualId = json.data.id;
    await carregarLista();
    document.getElementById('sel-prestacao').value = prestacaoAtualId;
    await carregarResumo(prestacaoAtualId);
  } catch (e) {
    console.error('Erro ao criar prestação:', e);
    alert('Erro: ' + e.message);
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
  if (!prestacaoAtualId) return alert('Selecione uma prestação primeiro.');
  const material = document.getElementById('item-material').value.trim();
  const peso_kg = document.getElementById('item-peso').value;
  const preco_por_kg = document.getElementById('item-preco').value;
  if (!material || !peso_kg || !preco_por_kg) return alert('Preencha todos os campos do item.');

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
  } catch (e) {
    console.error('Erro ao adicionar item:', e);
    alert('Erro: ' + e.message);
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
    alert('Erro: ' + e.message);
  }
}

// ─── ADICIONAR PAGAMENTO ───────────────────────────────────────

document.getElementById('btn-add-pag').addEventListener('click', async () => {
  if (!prestacaoAtualId) return alert('Selecione uma prestação primeiro.');
  const data = document.getElementById('pag-data').value;
  const valor = document.getElementById('pag-valor').value;
  const observacao = document.getElementById('pag-obs').value.trim();
  if (!data || !valor) return alert('Preencha data e valor do pagamento.');

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
  } catch (e) {
    console.error('Erro ao adicionar pagamento:', e);
    alert('Erro: ' + e.message);
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
    alert('Erro: ' + e.message);
  }
}

// ─── BOTÃO WHATSAPP (PLACEHOLDER) ─────────────────────────────

document.getElementById('btn-whatsapp').addEventListener('click', () => {
  console.log('Gerar imagem');
});

// ─── INIT ──────────────────────────────────────────────────────

carregarLista();
