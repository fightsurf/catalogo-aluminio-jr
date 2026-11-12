const express = require('express');
const router = express.Router();
const controller = require('../../controllers/produtoResumoCusto/produtoResumoCusto.controller');

router.get('/precificacao', controller.listarPrecificacao);
router.patch('/:id/preco-venda', controller.atualizarPrecoVenda);
router.get('/', controller.listar);

module.exports = router;
