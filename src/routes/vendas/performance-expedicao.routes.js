const express = require('express');
const controller = require('../../controllers/vendas/performance-expedicao.controller');

const router = express.Router();

router.get('/performance-expedicao', controller.carregarPerformanceMensal);
router.get('/performance-expedicao/pedidos-dia', controller.listarPedidosDoDia);
router.get('/performance-expedicao/sem-data-expedicao-semanas', controller.listarPedidosSemExpedicaoSemanas);
router.get('/expedidos-pendentes', controller.listarExpedidosPagamentoPendente);

module.exports = router;
