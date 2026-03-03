const express = require('express');
const router = express.Router();
const botIntencoesController = require('../../controllers/bot/botIntencoes.controller');

// CRUD Operations
router.get('/intencoes', botIntencoesController.getAllIntencoes);
router.get('/intencoes/:id', botIntencoesController.getIntencaoById);
router.post('/intencoes', botIntencoesController.createIntencao);
router.put('/intencoes/:id', botIntencoesController.updateIntencao);
router.delete('/intencoes/:id', botIntencoesController.deleteIntencao);

module.exports = router;