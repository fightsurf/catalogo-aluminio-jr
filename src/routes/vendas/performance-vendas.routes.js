const express = require('express');
const controller = require('../../controllers/vendas/performance-vendas.controller');

const router = express.Router();

router.get('/performance-vendas', controller.carregarPerformanceMensal);
router.get('/performance-vendas/pedidos-dia', controller.listarPedidosDoDia);

module.exports = router;
