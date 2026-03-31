const express = require('express');
const pedidosInsercaoViewController = require('../../../controllers/legado/pedidos-insercao/pedidos-insercao.view.controller');

const router = express.Router();

router.get('/', pedidosInsercaoViewController.abrirPaginaPedidosInsercao);
router.get('/relatorio', pedidosInsercaoViewController.abrirPaginaRelatorioPedidosInsercao);

module.exports = router;
