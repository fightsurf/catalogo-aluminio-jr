const executarIntencaoService = require('../../services/bot/executar-intencao.service');

async function executar(req, res) {
  try {
    const { telefone, intencao } = req.body || {};

    if (!telefone) {
      return res.status(400).json({ success: false, message: 'Campo "telefone" é obrigatório.' });
    }

    if (!intencao) {
      return res.status(400).json({ success: false, message: 'Campo "intencao" é obrigatório.' });
    }

    const resultado = await executarIntencaoService.executarIntencao({ telefone, intencao });
    return res.json(resultado);
  } catch (error) {
    const status = error.statusCode || 500;
    return res.status(status).json({ success: false, message: error.message });
  }
}

module.exports = {
  executar
};
