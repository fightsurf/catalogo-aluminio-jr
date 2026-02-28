const volumeService = require('../../services/volume/volume.service');

async function calcular(req, res) {
  try {
    const { texto, multiplicador = 1 } = req.body;

    if (!texto) {
      return res.status(400).json({ success: false, message: 'Campo "texto" é obrigatório' });
    }

    const dados = await volumeService.calcular(texto, multiplicador);
    res.json(dados);
  } catch (error) {
    if (
      error.message.startsWith('Produtos não encontrados:') ||
      error.message === 'Nenhum produto encontrado no texto'
    ) {
      return res.status(400).json({ erro: error.message });
    }
    res.status(500).json({ success: false, message: error.message });
  }
}

module.exports = { calcular };