const express = require('express');
const router = express.Router();
const controller = require('../controllers/logisticaController');

router.post('/transportadoras/:id/cidades', controller.vincular);
router.get('/transportadoras/:id/cidades', controller.cidades);
router.get('/cidades/:codigo_ibge/transportadoras', controller.transportadoras);

module.exports = router;
