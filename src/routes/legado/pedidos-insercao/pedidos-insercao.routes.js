const express = require('express');
const pedidosInsercaoController = require('../../../controllers/legado/pedidos-insercao/pedidos-insercao.controller');

const router = express.Router();

router.post('/', pedidosInsercaoController.inserirPedido);

module.exports = router;
