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
// GET /bot/fluxo/admin
// ──────────────────────────────────────────────────────────────
function getAdminView(req, res) {
  res.sendFile(path.join(__dirname, '..', '..', '..', 'views', 'bot', 'botFluxo.html'));
}

module.exports = { executarFluxo, getAcoesView, getAdminView };
