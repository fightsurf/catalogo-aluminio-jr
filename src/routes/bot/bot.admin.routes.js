const express = require('express');
const router = express.Router();
const controller = require('../../controllers/bot/bot.admin.controller');
const { requireAuth } = require('../../middlewares/adminAuth.middleware');

router.post('/conversas/abrir', controller.abrirOuCriarConversa);
router.post('/conversas/conferir-lid', requireAuth, controller.conferirLid);
router.get('/conversas', controller.listarConversas);
router.get('/monitoramento', requireAuth, controller.listarMonitoramento);
router.get('/mensagens/:telefone', controller.listarMensagens);

module.exports = router;
