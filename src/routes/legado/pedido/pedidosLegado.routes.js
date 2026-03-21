const express = require('express');
const controller = require('../../../src/controllers/legado/pedido/pedidosLegado.controller');

const router = express.Router();

router.get('/pedidos', controller.pesquisarPedidos);
router.get('/pedidos/:idMestre/itens', controller.buscarItensPedido);

module.exports = router;
