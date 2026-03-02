const botService = require('../../services/bot/bot.service');

async function receberMensagem(req, res) {
  try {
    const { telefone, mensagem, tipo } = req.body;

    if (!telefone || !mensagem || !tipo) {
      return res.status(400).json({ success: false, message: 'Campos obrigatórios: telefone, mensagem, tipo' });
    }

    const resultado = await botService.receberMensagem({ telefone, mensagem, tipo });

    res.json(resultado);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

module.exports = { receberMensagem };
