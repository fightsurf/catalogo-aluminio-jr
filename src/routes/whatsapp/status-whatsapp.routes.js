const express = require('express');
const controller = require('../../controllers/whatsapp/status-whatsapp.controller');
const agenda = require('../../controllers/whatsapp/status-agendamentos.controller');
const { requireAuth } = require('../../middlewares/adminAuth.middleware');

const router = express.Router();

router.get('/conexao', requireAuth, controller.verificarConexao);
router.get('/categorias', requireAuth, controller.listarCategorias);
router.get('/agendamentos', requireAuth, agenda.painel);
router.put('/agendamentos', requireAuth, agenda.salvar);
router.get('/produtos', requireAuth, controller.listarProdutos);
router.post('/produto', requireAuth, controller.enviarProduto);
router.get('/video-publicacao/:requestId', requireAuth, controller.consultarVideo);
router.post('/produto-status', requireAuth, controller.publicarProdutoNoStatus);
router.post('/categoria-facebook', requireAuth, controller.publicarCategoriaFacebook);

module.exports = router;
