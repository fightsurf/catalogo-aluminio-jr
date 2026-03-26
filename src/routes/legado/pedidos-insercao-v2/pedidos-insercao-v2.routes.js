const express = require('express');
const pedidosInsercaoV2Controller = require('../../../controllers/legado/pedidos-insercao-v2/pedidos-insercao-v2.controller');

const router = express.Router();

router.post('/', pedidosInsercaoV2Controller.inserirPedido);

module.exports = router;
