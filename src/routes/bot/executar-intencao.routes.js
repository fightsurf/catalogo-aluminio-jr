const express = require('express');
const router = express.Router();
const controller = require('../../controllers/bot/executar-intencao.controller');

router.post('/executar-intencao', controller.executar);

module.exports = router;
