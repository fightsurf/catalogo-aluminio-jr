const express = require('express');
const router = express.Router();

const {
  abrirPaginaPerformanceExpedicao,
  abrirPaginaExpedidosPendentes
} = require('../../controllers/vendas/performance-expedicao.view.controller');

router.get('/performance-expedicao', abrirPaginaPerformanceExpedicao);
router.get('/expedidos-pendentes', abrirPaginaExpedidosPendentes);

module.exports = router;
