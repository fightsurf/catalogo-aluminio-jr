const express = require('express');
const router = express.Router();
const controller = require('../../controllers/bot/bot.controller');

router.post('/receber-mensagem', controller.receberMensagem);

module.exports = router;
