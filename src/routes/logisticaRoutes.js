const express = require('express');
const router = express.Router();
const controller = require('../controllers/logisticaController');

router.post('/transportadoras/:id/cidades', controller.vincular);
router.delete('/transportadoras/:id/cidades/:codigo_ibge', controller.remover);
router.get('/transportadoras/:id/cidades', controller.cidades);
router.get('/cidades/:codigo_ibge/transportadoras', controller.transportadoras);
router.get('/cidades/busca', controller.buscarCidades);

module.exports = router;
