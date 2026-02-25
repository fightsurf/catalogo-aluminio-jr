const express = require('express');
const router = express.Router();
const service = require('../services/logisticaService');

// ==========================================
// CIDADES POR ESTADO
// GET /api/logistica/estado/:nomeEstado
// ==========================================
router.get('/estado/:nomeEstado', async (req, res) => {
  const { nomeEstado } = req.params;

  try {
    const resultado = await service.listarCidadesPorEstado(nomeEstado);
    res.json(resultado);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
