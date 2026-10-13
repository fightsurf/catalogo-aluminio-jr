const express = require('express');
const controller = require('../../controllers/vendas/termometro-vendas.controller');
const { requireAuth } = require('../../middlewares/adminAuth.middleware');

const router = express.Router();

router.get('/termometro-vendas', requireAuth, controller.carregarTermometro);
// Novo painel. As rotas antigas permanecem disponíveis para compatibilidade.
router.get('/termometro-vendas/painel', requireAuth, controller.carregarPainelSimplificado);
router.get('/termometro-vendas/configuracao', requireAuth, controller.listarConfiguracaoPainel);
router.post('/termometro-vendas/configuracao', requireAuth, controller.salvarConfiguracaoPainel);
router.get('/termometro-vendas/historico-produto/:produtoId', requireAuth, controller.carregarHistoricoProduto);

module.exports = router;
