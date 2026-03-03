const express = require('express');
const router = express.Router();
const controller = require('../../controllers/bot/classificadorIntencao.controllers');

router.post('/classificar-intencao/:telefone', controller.classificarIntencao);

module.exports = router;
