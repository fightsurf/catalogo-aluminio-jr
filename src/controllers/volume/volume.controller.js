const volumeService = require('../../services/volume/volume.service');

async function calcular(req, res) {
  try {
    const { texto, itens, multiplicador = 1 } = req.body;

    if (!texto && !itens) {
      return res.status(400).json({
        erro: 'Informe "texto" ou "itens" para calcular volumes'
      });
    }

    const dados = await volumeService.calcular({
      texto,
      itens,
      multiplicador
    });

    res.json(dados);

  } catch (error) {
    if (
      error.message.startsWith('Produtos não encontrados:') ||
      error.message === 'Nenhum produto encontrado no texto'
    ) {
      return res.status(400).json({ erro: error.message });
    }

    res.status(500).json({ erro: error.message });
  }
}

module.exports = { calcular };
