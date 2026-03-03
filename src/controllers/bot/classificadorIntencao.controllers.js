const classificadorService = require('../../services/bot/classificadorIntencao.services');

async function classificarIntencao(req, res) {
  try {
    const { telefone } = req.params;

    if (!telefone || !telefone.trim()) {
      return res.status(400).json({ success: false, message: 'Parâmetro telefone é obrigatório.' });
    }

    const resultado = await classificadorService.classificarIntencao(telefone);
    return res.json(resultado);
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ success: false, message: error.message });
  }
}

module.exports = { classificarIntencao };
