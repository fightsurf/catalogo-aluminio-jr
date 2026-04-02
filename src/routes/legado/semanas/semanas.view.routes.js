const express = require('express');
const controller = require('../../../controllers/legado/semanas/semanas.view.controller');

const router = express.Router();

router.get('/', controller.abrirPaginaSemanas);
router.get('/detalhe', controller.abrirPaginaDetalheSemana);
router.get('/resumo', controller.abrirPaginaResumoSemana);

module.exports = router;
