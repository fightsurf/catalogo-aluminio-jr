const express = require('express');
const router = express.Router();
const service = require('../services/logisticaService');

// Buscar transportadoras por nome da cidade
router.get('/frete', async (req, res) => {
  const { cidade } = req.query;

  if (!cidade) {
    return res.status(400).json({ error: 'Cidade é obrigatória' });
  }

  try {
    const resultado = await service.buscarTransportadorasPorNomeCidade(cidade);
    res.json(resultado);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao buscar frete' });
  }
});

module.exports = router;
