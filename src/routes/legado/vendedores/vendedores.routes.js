const express = require('express');
const vendedoresController = require('../../../controllers/legado/vendedores/vendedores.controller');

const router = express.Router();

router.get('/', vendedoresController.listarVendedores);

module.exports = router;
