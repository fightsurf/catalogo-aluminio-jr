const express = require('express');
const router = express.Router();
const botIntencoesController = require('../../controllers/bot/botIntencoes.controller');

router.get('/intencoes', botIntencoesController.listarTodas);
router.post('/intencoes', botIntencoesController.criar);
router.put('/intencoes/:id', botIntencoesController.atualizar);
router.delete('/intencoes/:id', botIntencoesController.deletar);
router.get('/intencoes-ativas', botIntencoesController.listarAtivas);

module.exports = router;