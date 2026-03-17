const express = require('express');
const router = express.Router();

// 🔥 CAMINHO CORRIGIDO
const service = require('../../services/logistica/logisticaService');

// ==========================================
// CIDADES POR ESTADO
// ==========================================
router.get('/estado/:nomeEstado', async (req, res) => {
  try {
    const resultado = await service.listarCidadesPorEstado(req.params.nomeEstado);
    res.json(resultado);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// BUSCAR CIDADES POR NOME (LOGÍSTICA - IBGE)
// ==========================================
router.get('/cidades/busca', async (req, res) => {
  try {
    const resultado = await service.buscarCidadesPorNome(req.query.nome);
    res.json(resultado);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// 🔥 NOVA ROTA PARA FORNECEDORES (USA ID REAL)
// ==========================================
router.get('/cidades/busca-id', async (req, res) => {
  try {
    const resultado = await service.buscarCidadesPorNomeComId(req.query.nome);
    res.json(resultado);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// LISTAR CIDADES DA TRANSPORTADORA
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
// 🔥 BUSCAR CIDADE POR ID
// ==========================================
router.get('/cidades/id/:id', async (req, res) => {
  try {
    const resultado = await service.buscarCidadePorId(req.params.id);

    if (!resultado) {
      return res.status(404).json({ error: 'Cidade não encontrada' });
    }

    res.json(resultado);

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// CONSULTAR FRETE POR NOME DA CIDADE
// ==========================================
router.get('/frete', async (req, res) => {
  const { cidade } = req.query;

  if (!cidade) {
    return res.status(400).json({ error: 'Cidade não informada' });
  }

  try {
    const resultado = await service.buscarTransportadorasPorNomeCidade(cidade);
    res.json(resultado);

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
