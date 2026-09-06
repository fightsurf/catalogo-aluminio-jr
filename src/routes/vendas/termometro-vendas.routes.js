const express = require('express');
const controller = require('../../controllers/vendas/termometro-vendas.controller');
const { requireAuth } = require('../../middlewares/adminAuth.middleware');

const router = express.Router();

router.get('/termometro-vendas', requireAuth, controller.carregarTermometro);
router.get('/termometro-vendas/historico-produto/:produtoId', requireAuth, controller.carregarHistoricoProduto);

module.exports = router;
