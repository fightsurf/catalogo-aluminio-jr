const express = require('express');
const pedidosInsercaoV2ViewController = require('../../../controllers/legado/pedidos-insercao-v2/pedidos-insercao-v2.view.controller');

const router = express.Router();

router.get('/', pedidosInsercaoV2ViewController.abrirPaginaPedidosInsercaoV2);

module.exports = router;
