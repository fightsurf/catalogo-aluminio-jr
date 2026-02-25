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

// ==========================================
// BUSCAR CIDADE POR NOME
// GET /api/logistica/cidades/busca?nome=
// ==========================================
router.get('/cidades/busca', async (req, res) => {
  const { nome } = req.query;

  try {
    const resultado = await service.buscarCidadePorNome(nome);
    res.json(resultado);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// LISTAR CIDADES DE UMA TRANSPORTADORA
// GET /api/logistica/transportadoras/:id/cidades
// ==========================================
router.get('/transportadoras/:id/cidades', async (req, res) => {
  const { id } = req.params;

  try {
    const resultado = await service.listarCidadesDaTransportadora(id);
    res.json(resultado);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// VINCULAR CIDADE
// POST /api/logistica/transportadoras/:id/cidades
// ==========================================
router.post('/transportadoras/:id/cidades', async (req, res) => {
  const { id } = req.params;
  const { codigo_ibge, observacao } = req.body;

  try {
    const resultado = await service.vincularCidade(id, codigo_ibge, observacao);
    res.json(resultado);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// REMOVER CIDADE
// DELETE /api/logistica/transportadoras/:id/cidades/:codigo_ibge
// ==========================================
router.delete('/transportadoras/:id/cidades/:codigo_ibge', async (req, res) => {
  const { id, codigo_ibge } = req.params;

  try {
    const resultado = await service.removerCidade(id, codigo_ibge);
    res.json(resultado);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
