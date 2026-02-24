const express = require('express');
const router = express.Router();
const service = require('../services/logisticaService');

// =====================================================
// 🔍 Buscar transportadoras por nome da cidade
// GET /api/logistica/frete?cidade=nome
// =====================================================

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
    res.status(500).json({ error: error.message });
  }
});

// =====================================================
// 📍 Listar cidades de uma transportadora
// GET /api/logistica/transportadoras/:id/cidades
// =====================================================

router.get('/transportadoras/:id/cidades', async (req, res) => {
  const { id } = req.params;

  try {
    const resultado = await service.listarCidadesPorTransportadora(id);
    res.json(resultado);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// =====================================================
// ➕ Vincular cidade
// POST /api/logistica/transportadoras/:id/cidades
// =====================================================

router.post('/transportadoras/:id/cidades', async (req, res) => {
  const { id } = req.params;
  const { codigo_ibge, observacao } = req.body;

  if (!codigo_ibge) {
    return res.status(400).json({ error: 'codigo_ibge é obrigatório' });
  }

  try {
    const resultado = await service.vincularCidade(
      id,
      codigo_ibge,
      observacao
    );

    res.status(201).json(resultado);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// =====================================================
// ❌ Remover cidade
// DELETE /api/logistica/transportadoras/:id/cidades/:codigo_ibge
// =====================================================

router.delete('/transportadoras/:id/cidades/:codigo_ibge', async (req, res) => {
  const { id, codigo_ibge } = req.params;

  try {
    await service.removerCidade(id, codigo_ibge);
    res.json({ sucesso: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
