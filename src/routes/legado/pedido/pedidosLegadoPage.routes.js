const express = require('express');
const controller = require('../../../controllers/legado/pedido/pedidosLegadoPage.controller');

const router = express.Router();

router.get('/legado/pedidos', controller.abrirPaginaPedidosLegado);

module.exports = router;
