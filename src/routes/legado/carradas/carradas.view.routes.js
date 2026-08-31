const express = require('express');
const controller = require('../../../controllers/legado/carradas/carradas.view.controller');

const router = express.Router();

router.get('/', controller.abrirPaginaCarradas);
router.get('/mobile/detalhe', controller.abrirPaginaDetalheCarradaMobile);
router.get('/detalhe', controller.abrirPaginaDetalheCarrada);
router.get('/resumo-itens', controller.abrirPaginaResumoItensCarrada);
router.get('/resumo-selecionado', controller.abrirPaginaResumoSelecionadoCarradas);
router.get('/resumo-producao', controller.abrirPaginaResumoProducaoCarrada);
router.get('/progresso', controller.abrirPaginaProgressoCarrada);

module.exports = router;
