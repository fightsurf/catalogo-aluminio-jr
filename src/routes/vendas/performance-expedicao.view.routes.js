const express = require('express');
const router = express.Router();

const {
  abrirPaginaPerformanceExpedicao
} = require('../../controllers/vendas/performance-expedicao.view.controller');

router.get('/performance-expedicao', abrirPaginaPerformanceExpedicao);

module.exports = router;
