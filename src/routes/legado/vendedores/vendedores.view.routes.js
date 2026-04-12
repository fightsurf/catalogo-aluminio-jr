const express = require('express');
const vendedoresViewController = require('../../../controllers/legado/vendedores/vendedores.view.controller');

const router = express.Router();

router.get('/', vendedoresViewController.abrirPaginaVendedores);

module.exports = router;
