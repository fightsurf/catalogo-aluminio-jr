const express = require('express');
const controller = require('../../../controllers/legado/clientes-creditos/clientes-creditos.controller');

const router = express.Router();

router.get('/', controller.listarClientes);
router.get('/:favorecido/extrato', controller.buscarExtrato);
router.put('/:favorecido/lancamentos/:lancamentoId', controller.atualizarLancamento);
router.post('/:favorecido/ajustes', controller.registrarAjusteCliente);
router.post('/:favorecido/pagamentos', controller.registrarPagamentoCliente);

module.exports = router;
