
const express = require('express');
const controller = require('../../../controllers/legado/pagamentos/pagamentos.view.controller');

const router = express.Router();

router.get('/distribuir', controller.abrirPaginaDistribuirPagamento);
router.get('/realizados', controller.abrirPaginaPagamentosRealizados);
router.get('/mobile', controller.abrirPaginaPagamentosMobile);
router.get('/', controller.abrirPaginaPagamentos);

module.exports = router;
