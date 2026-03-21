const express = require('express');
const clientesViewController = require('../../../controllers/legado/clientes/clientes.view.controller');

const router = express.Router();

router.get('/', clientesViewController.abrirPaginaClientes);

module.exports = router;
