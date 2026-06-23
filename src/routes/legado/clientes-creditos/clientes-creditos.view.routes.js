const express = require('express');
const controller = require('../../../controllers/legado/clientes-creditos/clientes-creditos.view.controller');

const router = express.Router();

router.get('/', controller.abrirListagem);
router.get('/extrato', controller.abrirExtrato);

module.exports = router;
