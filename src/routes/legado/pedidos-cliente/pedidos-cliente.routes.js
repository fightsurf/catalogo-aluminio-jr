const express = require('express');
const router = express.Router();

const pedidosClienteController = require('../../../controllers/legado/pedidos-cliente/pedidos-cliente.controller');

router.get('/:favorecido', pedidosClienteController.listarPedidosPorCliente);
router.post('/:favorecido/whatsapp/resumo-imagem', pedidosClienteController.enviarResumoImagemWhatsapp);

module.exports = router;
