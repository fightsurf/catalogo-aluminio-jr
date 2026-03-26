const express = require('express');
const pedidosInsercaoViewController = require('../../../controllers/legado/pedidos-insercao/pedidos-insercao.view.controller');

const router = express.Router();

router.get('/', pedidosInsercaoViewController.abrirPaginaPedidosInsercao);

module.exports = router;
