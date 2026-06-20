const express = require('express');
const controller = require('../../../controllers/legado/pedidos-insercao-mobile/pedidos-insercao-mobile.view.controller');

const router = express.Router();

router.get('/', controller.abrirPaginaPedidosInsercaoMobile);

module.exports = router;
