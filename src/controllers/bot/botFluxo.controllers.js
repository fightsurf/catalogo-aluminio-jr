const path = require('path');
const botFluxoService = require('../../services/bot/botFluxo.services');

async function executarFluxo(req, res) {
  const telefone = String(req.body.telefone || '').trim();
  const intencao = String(req.body.intencao || '').trim().toUpperCase();

  if (!telefone) {
    return res.status(400).json({ success: false, message: 'Campo "telefone" é obrigatório.' });
  }

  if (!intencao) {
    return res.status(400).json({ success: false, message: 'Campo "intencao" é obrigatório.' });
  }

  res.status(202).json({ status: 'fluxo_iniciado' });

  setImmediate(async () => {
    try {
      const resultado = await botFluxoService.executarFluxo(telefone, intencao);
      console.log(`[botFluxo] background concluído | telefone=${telefone} intencao=${intencao} status=${resultado.status}`);
    } catch (err) {
      console.error(`[botFluxo] erro no background | telefone=${telefone} intencao=${intencao}: ${err.message}`);
    }
  });
}

async function getAcoesView(req, res) {
  try {
    const acoes = await botFluxoService.listarAcoes();
    res.json(acoes);
  } catch (err) {
    console.error('[botFluxo] erro ao listar ações:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function criarAcao(req, res) {
  try {
    const acao = await botFluxoService.criarAcao(req.body);
    res.status(201).json({ success: true, acao });
  } catch (err) {
    console.error('[botFluxo] erro ao criar ação:', err.message);
    res.status(400).json({ success: false, message: err.message });
  }
}

async function atualizarAcao(req, res) {
  try {
    const acao = await botFluxoService.atualizarAcao(req.params.id, req.body);
    if (!acao) {
      return res.status(404).json({ success: false, message: 'Ação não encontrada.' });
    }
    res.json({ success: true, acao });
  } catch (err) {
    console.error('[botFluxo] erro ao atualizar ação:', err.message);
    res.status(400).json({ success: false, message: err.message });
  }
}

async function deletarAcao(req, res) {
  try {
    const result = await botFluxoService.deletarAcao(req.params.id);
    if (!result) {
      return res.status(404).json({ success: false, message: 'Ação não encontrada.' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error('[botFluxo] erro ao deletar ação:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
}

function getAdminView(req, res) {
  res.sendFile(path.join(__dirname, '..', '..', '..', 'views', 'bot', 'botFluxo.html'));
}

module.exports = {
  executarFluxo,
  getAcoesView,
  criarAcao,
  atualizarAcao,
  deletarAcao,
  getAdminView
};
