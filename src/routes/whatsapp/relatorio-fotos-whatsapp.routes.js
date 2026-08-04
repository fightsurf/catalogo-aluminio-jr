const express = require('express');
const controller = require('../../controllers/whatsapp/relatorio-fotos-whatsapp.controller');

const router = express.Router();

router.post('/analisar', controller.analisar);
router.post('/enviar-item', controller.enviarItem);
router.post('/finalizar', controller.finalizar);

module.exports = router;
