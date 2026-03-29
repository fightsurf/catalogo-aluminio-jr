
const express = require('express');
const controller = require('../../../controllers/legado/pagamentos/pagamentos.controller');

const router = express.Router();

router.get('/clientes', controller.listarClientes);
router.get('/pedidos/por-cliente/:favorecido', controller.listarPedidosPorCliente);
router.get('/pedidos/por-data', controller.listarPedidosPorData);
router.get('/pedidos/por-numero', controller.listarPedidosPorNumero);
router.get('/pedido', controller.buscarPedidoComPagamentos);
router.post('/', controller.criarPagamento);
router.put('/:codigo', controller.atualizarPagamento);
router.delete('/:codigo', controller.excluirPagamento);

module.exports = router;
