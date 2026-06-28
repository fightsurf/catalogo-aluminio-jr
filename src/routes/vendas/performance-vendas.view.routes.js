const express = require('express');
const router = express.Router();

const {
  abrirPaginaPerformanceVendas
} = require('../../controllers/vendas/performance-vendas.view.controller');

router.get('/performance-vendas', abrirPaginaPerformanceVendas);

module.exports = router;
