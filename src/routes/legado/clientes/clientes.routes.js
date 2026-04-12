const express = require('express');
const clientesController = require('../../../controllers/legado/clientes/clientes.controller');

const router = express.Router();

router.get('/', clientesController.listarClientes);
router.get('/:favorecido', clientesController.buscarCliente);
router.post('/', clientesController.criarCliente);
router.put('/:favorecido', clientesController.atualizarCliente);
router.delete('/:favorecido', clientesController.desativarCliente);

module.exports = router;
