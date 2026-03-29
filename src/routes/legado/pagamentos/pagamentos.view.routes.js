
const express = require('express');
const controller = require('../../../controllers/legado/pagamentos/pagamentos.view.controller');

const router = express.Router();

router.get('/', controller.abrirPaginaPagamentos);

module.exports = router;
