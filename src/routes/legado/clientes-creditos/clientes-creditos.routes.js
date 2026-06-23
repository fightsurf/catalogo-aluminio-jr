const express = require('express');
const controller = require('../../../controllers/legado/clientes-creditos/clientes-creditos.controller');

const router = express.Router();

router.get('/', controller.listarClientes);
router.get('/:favorecido/extrato', controller.buscarExtrato);
router.post('/:favorecido/ajustes', controller.registrarAjusteCliente);
router.post('/:favorecido/pagamentos', controller.registrarPagamentoCliente);

module.exports = router;
