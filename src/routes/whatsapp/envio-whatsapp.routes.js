const express = require('express');
const controller = require('../../controllers/whatsapp/envio-whatsapp.controller');

const router = express.Router();

router.post('/enviar', controller.enviarMensagem);

module.exports = router;
