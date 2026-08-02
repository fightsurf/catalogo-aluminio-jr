const express = require('express');
const controller = require('../../controllers/pedidos/pedidosLegado.controller');

const router = express.Router();

router.get('/pedidos', controller.pesquisarPedidos);
router.get('/pedidos/:idMestre/detalhe', controller.buscarDetalhePedido);
router.get('/pedidos/:idMestre/itens', controller.buscarItensPedido);
router.get('/pedidos/:idMestre/carradas-disponiveis', controller.listarCarradasDisponiveis);
router.put('/pedidos/:idMestre/carrada', controller.alterarCarradaPedido);
router.put('/pedidos/:idMestre/volumes', controller.atualizarVolumesPedido);
router.post('/pedidos/:idMestre/particionar', controller.particionarPedido);
router.put('/pedidos/:idMestre', controller.atualizarPedido);

module.exports = router;
