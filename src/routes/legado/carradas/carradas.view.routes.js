const express = require('express');
const controller = require('../../../controllers/legado/carradas/carradas.view.controller');

const router = express.Router();

router.get('/', controller.abrirPaginaCarradas);
router.get('/detalhe', controller.abrirPaginaDetalheCarrada);

module.exports = router;
