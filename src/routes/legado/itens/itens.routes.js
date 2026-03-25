const express = require('express');
const itensController = require('../../../controllers/legado/itens/itens.controller');

const router = express.Router();

router.get('/', itensController.listarItens);
router.get('/:item', itensController.buscarItem);
router.put('/:item/descricao', itensController.atualizarDescricao);
router.post('/sincronizar-descricao', itensController.sincronizarDescricaoProduto);

module.exports = router;
