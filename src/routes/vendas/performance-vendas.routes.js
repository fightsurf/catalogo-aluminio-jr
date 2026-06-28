const express = require('express');
const controller = require('../../controllers/vendas/performance-vendas.controller');

const router = express.Router();

router.get('/performance-vendas', controller.carregarPerformanceMensal);

module.exports = router;
