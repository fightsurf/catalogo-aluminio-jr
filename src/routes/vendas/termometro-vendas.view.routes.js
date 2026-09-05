const express = require('express');
const { requireAuth } = require('../../middlewares/adminAuth.middleware');
const controller = require('../../controllers/vendas/termometro-vendas.view.controller');

const router = express.Router();

router.get('/termometro-vendas', requireAuth, controller.abrirPaginaTermometroVendas);

module.exports = router;
