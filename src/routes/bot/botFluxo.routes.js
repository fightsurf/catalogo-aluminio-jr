const express = require('express');
const router = express.Router();
const controller = require('../../controllers/bot/botFluxo.controllers');

router.post('/executar', controller.executarFluxo);
router.get('/admin/acoes', controller.getAcoesView);
router.get('/admin', controller.getAdminView);

module.exports = router;
