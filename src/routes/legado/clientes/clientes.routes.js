const express = require('express');
const clientesController = require('../../../controllers/legado/clientes/clientes.controller');

const router = express.Router();

router.get('/', clientesController.listarClientes);

module.exports = router;
