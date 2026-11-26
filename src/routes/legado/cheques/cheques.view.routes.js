const express = require('express');
const controller = require('../../../controllers/legado/cheques/cheques.view.controller');

const router = express.Router();

router.get('/', controller.abrirPaginaCheques);
router.get('/controle', controller.abrirControleCheques);

module.exports = router;
