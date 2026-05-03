const express = require('express');
const router = express.Router();
const controller = require('../../controllers/produtoComposicao/produtoComposicao.controller');

router.get('/insumos', controller.listarInsumosDisponiveis);
router.get('/produto/:produtoId', controller.listarPorProduto);
router.get('/:id', controller.buscar);
router.post('/', controller.criar);
router.put('/:id', controller.atualizar);
router.put('/:id/itens', controller.salvarItens);
router.delete('/:id', controller.excluir);

module.exports = router;
