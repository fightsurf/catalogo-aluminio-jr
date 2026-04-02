const express = require('express');
const controller = require('../../controllers/whatsapp/envio-whatsapp.view.controller');

const router = express.Router();

router.get('/enviar', controller.abrirPaginaEnvioWhatsapp);

module.exports = router;
