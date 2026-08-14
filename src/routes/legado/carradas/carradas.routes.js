const express = require('express');
const controller = require('../../../controllers/legado/carradas/carradas.controller');

const router = express.Router();

router.get('/clientes', controller.listarClientes);
router.get('/pedidos/por-cliente/:favorecido', controller.listarPedidosPorCliente);
router.get('/pedidos/por-data', controller.listarPedidosPorData);
router.get('/pedidos/por-numero', controller.listarPedidosPorNumero);
router.get('/', controller.listarCarradas);
router.get('/:codigo/carradas-disponiveis', controller.listarCarradasDisponiveis);
router.put('/:codigo/bloqueio-vendas', controller.atualizarBloqueioVendas);
router.get('/:codigo', controller.buscarCarrada);
router.post('/', controller.criarCarrada);
router.put('/:codigo', controller.atualizarCarrada);
router.post('/:codigo/pedidos/mover', controller.moverPedidoEntreCarradas);
router.delete('/:codigo', controller.excluirCarrada);

module.exports = router;
