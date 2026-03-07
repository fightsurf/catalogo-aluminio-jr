const botAutonomiaService = require('../../services/bot/botAutonomia.services');

async function getStatus(req, res) {
  try {
    const ativa = await botAutonomiaService.getAutonomiaAtiva();
    res.json({ ativa });
  } catch (err) {
    console.error('[botAutonomia] erro ao consultar status:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function setStatus(req, res) {
  try {
    const ativa = !!req.body.ativa;
    const result = await botAutonomiaService.setAutonomiaAtiva(ativa);
    res.json({ success: true, ativa: result.ativa });
  } catch (err) {
    console.error('[botAutonomia] erro ao salvar status:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = {
  getStatus,
  setStatus
};
