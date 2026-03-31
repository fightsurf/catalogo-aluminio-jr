const express = require('express');
const controller = require('../../../controllers/legado/relatorio-pedido/relatorio-pedido.view.controller');

const router = express.Router();

router.get('/', controller.abrirRelatorioPedido);

module.exports = router;
