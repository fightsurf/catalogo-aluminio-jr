const express = require('express');
const router = express.Router();
const controller = require('../controllers/logisticaController');

// Vincular cidade à transportadora
router.post('/transportadoras/:id/cidades', controller.vincular);

// Listar cidades da transportadora
router.get('/transportadoras/:id/cidades', controller.cidades);

// Listar transportadoras por cidade
router.get('/cidades/:codigo_ibge/transportadoras', controller.transportadoras);

// Buscar cidades por nome (autocomplete frontend)
router.get('/cidades/busca', controller.buscarCidades);

module.exports = router;
