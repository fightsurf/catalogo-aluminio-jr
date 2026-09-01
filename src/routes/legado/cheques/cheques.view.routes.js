const express = require('express');
const controller = require('../../../controllers/legado/cheques/cheques.view.controller');

const router = express.Router();

router.get('/', controller.abrirPaginaCheques);

module.exports = router;
