const express = require('express');
const controller = require('../../controllers/whatsapp/relatorio-fotos-whatsapp.view.controller');

const router = express.Router();

router.get('/relatorio-fotos', controller.abrirPagina);

module.exports = router;
