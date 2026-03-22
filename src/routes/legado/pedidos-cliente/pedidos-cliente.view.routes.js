const express = require('express');
const router = express.Router();

const pedidosClienteViewController = require('../../../controllers/legado/pedidos-cliente/pedidos-cliente.view.controller');

router.get('/', pedidosClienteViewController.abrirPaginaPedidosCliente);

module.exports = router;
