const express = require('express');
const itensController = require('../../../controllers/legado/itens/itens.controller');

const router = express.Router();

router.get('/', itensController.listarItens);
router.get('/:item', itensController.buscarItem);
router.put('/:item/descricao', itensController.atualizarDescricao);
router.post('/sincronizar-descricao', itensController.sincronizarDescricaoProduto);
router.post('/associar', itensController.associarProdutoAoItemLegado);
router.post('/transferir-associacao', itensController.transferirAssociacaoProdutoAoItemLegado);
router.delete('/associacao/:produtoId', itensController.desassociarProdutoDoItemLegado);

module.exports = router;
