const express = require('express');
const controller = require('../../../controllers/legado/pedido/pedidosLegadoPage.controller');

const router = express.Router();

router.get('/legado/pedidos', controller.abrirPaginaPedidosLegado);
router.get('/legado/pedidos/mobile', controller.abrirPaginaPedidosMobile);

module.exports = router;
