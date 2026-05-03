const express = require('express');
const router = express.Router();
const controller = require('../../controllers/pedidoFornecedor/pedidoFornecedor.controller');

router.get('/fornecedores', controller.listarFornecedores);
router.get('/fornecedor/:fornecedorId/itens', controller.listarItensPorFornecedor);

module.exports = router;
