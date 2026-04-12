const express = require('express');
const controller = require('../../../controllers/legado/pedido/pedidosLegado.controller');
const router = express.Router();

router.get('/pedidos', controller.pesquisarPedidos);
router.get('/pedidos/:idMestre/itens', controller.buscarItensPedido);
router.put('/pedidos/:idMestre', controller.atualizarPedido);

module.exports = router;
