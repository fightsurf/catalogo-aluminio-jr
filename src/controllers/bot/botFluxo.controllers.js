const path = require('path');
const botFluxoService = require('../../services/bot/botFluxo.services');

// ──────────────────────────────────────────────────────────────
// POST /bot/fluxo/executar
// ──────────────────────────────────────────────────────────────
async function executarFluxo(req, res) {
  const { telefone, intencao } = req.body;

  if (!telefone || !String(telefone).trim()) {
    return res.status(400).json({ success: false, message: 'Campo "telefone" é obrigatório.' });
  }
  if (!intencao || !String(intencao).trim()) {
    return res.status(400).json({ success: false, message: 'Campo "intencao" é obrigatório.' });
  }

  const tel = String(telefone).trim();
  const int = String(intencao).trim();

  // Responde imediatamente e processa em background
  res.status(202).json({ status: 'fluxo_iniciado' });

  setImmediate(async () => {
    try {
      const resultado = await botFluxoService.executarFluxo(tel, int);
      console.log(`[botFluxo] background concluído | telefone=${tel} intencao=${int} status=${resultado.status}`);
    } catch (err) {
      console.error(`[botFluxo] erro no background | telefone=${tel} intencao=${int}:`, err.message);
    }
  });
}

// ──────────────────────────────────────────────────────────────
// GET /bot/fluxo/admin/acoes
// ──────────────────────────────────────────────────────────────
async function getAcoesView(req, res) {
  try {
    const acoes = await botFluxoService.listarAcoes();
    res.json(acoes);
  } catch (err) {
    console.error('[botFluxo] erro ao listar ações:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ──────────────────────────────────────────────────────────────
// POST /bot/fluxo/admin/acoes
// ──────────────────────────────────────────────────────────────
async function criarAcao(req, res) {
  try {
    const acao = await botFluxoService.criarAcao(req.body);
    res.status(201).json({ success: true, acao });
  } catch (err) {
    console.error('[botFluxo] erro ao criar ação:', err.message);
    res.status(400).json({ success: false, message: err.message });
  }
}

// ──────────────────────────────────────────────────────────────
// PUT /bot/fluxo/admin/acoes/:id
// ──────────────────────────────────────────────────────────────
async function atualizarAcao(req, res) {
  try {
    const acao = await botFluxoService.atualizarAcao(req.params.id, req.body);
    if (!acao) return res.status(404).json({ success: false, message: 'Ação não encontrada.' });
    res.json({ success: true, acao });
  } catch (err) {
    console.error('[botFluxo] erro ao atualizar ação:', err.message);
    res.status(400).json({ success: false, message: err.message });
  }
}

// ──────────────────────────────────────────────────────────────
// DELETE /bot/fluxo/admin/acoes/:id
// ──────────────────────────────────────────────────────────────
async function deletarAcao(req, res) {
  try {
    const result = await botFluxoService.deletarAcao(req.params.id);
    if (!result) return res.status(404).json({ success: false, message: 'Ação não encontrada.' });
    res.json({ success: true });
  } catch (err) {
    console.error('[botFluxo] erro ao deletar ação:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ──────────────────────────────────────────────────────────────
// GET /bot/fluxo/admin
// ──────────────────────────────────────────────────────────────
function getAdminView(req, res) {
  res.sendFile(path.join(__dirname, '..', '..', '..', 'views', 'bot', 'botFluxo.html'));
}

module.exports = { executarFluxo, getAcoesView, criarAcao, atualizarAcao, deletarAcao, getAdminView };
