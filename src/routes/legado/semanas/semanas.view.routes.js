const express = require('express');
const controller = require('../../../controllers/legado/semanas/semanas.view.controller');

const router = express.Router();

router.get('/', controller.abrirPaginaSemanas);
router.get('/mobile', controller.abrirPaginaSemanasMobile);
router.get('/mobile/detalhe', controller.abrirPaginaDetalheSemanaMobile);
router.get('/detalhe', controller.abrirPaginaDetalheSemana);
router.get('/resumo', controller.abrirPaginaResumoSemana);
router.get('/resumo-producao', controller.abrirPaginaResumoProducaoSemana);

module.exports = router;
