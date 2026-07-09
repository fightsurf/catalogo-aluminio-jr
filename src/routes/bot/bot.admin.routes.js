const express = require('express');
const router = express.Router();
const controller = require('../../controllers/bot/bot.admin.controller');

router.post('/conversas/abrir', controller.abrirOuCriarConversa);
router.get('/conversas', controller.listarConversas);
router.get('/mensagens/:telefone', controller.listarMensagens);

module.exports = router;
