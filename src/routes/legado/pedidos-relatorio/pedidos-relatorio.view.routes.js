const express = require('express');
const pedidosRelatorioViewController = require('../../../controllers/legado/pedidos-relatorio/pedidos-relatorio.view.controller');

const router = express.Router();

router.get('/', pedidosRelatorioViewController.abrirPaginaPedidosRelatorio);

module.exports = router;
