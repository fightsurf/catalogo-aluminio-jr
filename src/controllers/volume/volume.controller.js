const volumeService = require('../../services/volume/volume.service');

async function calcular(req, res) {
  try {
    const { texto } = req.body;

    if (!texto) {
      return res.status(400).json({ success: false, message: 'Campo "texto" é obrigatório' });
    }

    const dados = await volumeService.calcular(texto);
    res.json(dados);
  } catch (error) {
    if (error.message.startsWith('Produtos não encontrados:')) {
      return res.status(400).json({ erro: error.message });
    }
    res.status(500).json({ success: false, message: error.message });
  }
}

module.exports = { calcular };
