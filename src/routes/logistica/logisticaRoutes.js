const express = require('express');
const router = express.Router();
const service = require('../../services/logistica/logisticaService');
const controller = require('../../controllers/logistica/logisticaController');

// ==========================================
// LISTAR ESTADOS
// ==========================================
router.get('/estados', async (req, res) => {
  try {
    const estados = await service.listarEstados();
    res.json(estados);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// LISTAR CIDADES + TRANSPORTADORAS POR UF
// ==========================================
router.get('/estado/:uf', controller.listarPorEstado);

// ==========================================
// LISTAR SOMENTE CIDADES POR UF
// ==========================================
router.get('/estado/:uf/cidades', controller.listarSomenteCidades);

// ==========================================
// 🔥 BUSCAR CIDADES POR NOME (RETORNA ID)
// ==========================================
router.get('/cidades/busca-id', async (req, res) => {
  try {
    const { nome } = req.query;

    if (!nome) {
      return res.status(400).json({ error: 'Nome não informado' });
    }

    const resultado = await service.buscarCidadesPorNome(nome);
    res.json(resultado);

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// 🔥 BUSCAR CIDADE POR ID (USADO NO EDITAR)
// ==========================================
router.get('/cidades/id/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const cidade = await service.buscarCidadePorId(id);

    if (!cidade) {
      return res.status(404).json({ error: 'Cidade não encontrada' });
    }

    res.json(cidade);

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// BUSCAR CIDADES POR NOME (ANTIGO)
// ==========================================
router.get('/cidades/busca', async (req, res) => {
  try {
    const { nome } = req.query;

    if (!nome) {
      return res.status(400).json({ error: 'Nome não informado' });
    }

    const resultado = await service.buscarCidadesPorNome(nome);
    res.json(resultado);

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// CRIAR NOVA CIDADE
// ==========================================
router.post('/cidades', async (req, res) => {
  try {
    const { nome, estado } = req.body;

    if (!nome || !estado) {
      return res.status(400).json({ error: 'Nome e estado são obrigatórios' });
    }

    const novaCidade = await service.criarCidade(nome, estado);
    res.status(201).json(novaCidade);

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// LISTAR CIDADES POR TRANSPORTADORA
// ==========================================
router.get('/transportadoras/:id/cidades', async (req, res) => {
  try {
    const resultado = await service.listarCidades(req.params.id);
    res.json(resultado);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// VINCULAR CIDADE
// ==========================================
router.post('/transportadoras/:id/cidades', async (req, res) => {
  try {
    const { codigo_ibge, observacao } = req.body;

    const resultado = await service.vincularCidade(
      req.params.id,
      codigo_ibge,
      observacao
    );

    res.json(resultado);

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// REMOVER CIDADE
// ==========================================
router.delete('/transportadoras/:id/cidades/:codigo_ibge', async (req, res) => {
  try {
    await service.removerCidade(
      req.params.id,
      req.params.codigo_ibge
    );

    res.json({ success: true });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// CONSULTAR FRETE (BOT)
// ==========================================
router.get('/frete', async (req, res) => {
  try {
    const { cidade } = req.query;

    if (!cidade) {
      return res.status(400).json({ error: 'Cidade não informada' });
    }

    const resultado = await service.buscarTransportadorasPorNomeCidade(cidade);
    res.json(resultado);

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
