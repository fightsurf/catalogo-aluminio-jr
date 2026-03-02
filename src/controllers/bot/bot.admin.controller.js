const botAdminService = require('../../services/bot/bot.admin.service');

async function listarConversas(req, res) {
  try {
    const { page, limit, data_inicio, data_fim, nivel_atendimento, telefone } = req.query;
    const resultado = await botAdminService.listarConversas({
      page,
      limit,
      data_inicio,
      data_fim,
      nivel_atendimento,
      telefone
    });
    res.json(resultado);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

async function listarMensagens(req, res) {
  try {
    const { telefone } = req.params;
    const { page, limit } = req.query;

    if (!telefone) {
      return res.status(400).json({ success: false, message: 'Telefone é obrigatório' });
    }

    const resultado = await botAdminService.listarMensagens({ telefone, page, limit });
    res.json(resultado);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

module.exports = { listarConversas, listarMensagens };
