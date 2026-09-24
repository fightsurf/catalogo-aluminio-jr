const express = require('express');
const controller = require('../../controllers/whatsapp/relatorios-recebidos.view.controller');

const router = express.Router();

router.get('/relatorios-recebidos', controller.abrirPagina);

module.exports = router;
