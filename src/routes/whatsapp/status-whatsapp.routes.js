const express = require('express');
const controller = require('../../controllers/whatsapp/status-whatsapp.controller');
const { requireAuth } = require('../../middlewares/adminAuth.middleware');

const router = express.Router();

router.get('/conexao', requireAuth, controller.verificarConexao);
router.get('/categorias', requireAuth, controller.listarCategorias);
router.get('/produtos', requireAuth, controller.listarProdutos);
router.post('/produto', requireAuth, controller.publicarProduto);

module.exports = router;
