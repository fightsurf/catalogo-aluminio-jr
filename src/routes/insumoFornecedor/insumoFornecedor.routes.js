const express = require('express');
const router = express.Router();
const controller = require('../../controllers/insumoFornecedor/insumoFornecedor.controller');

router.get('/', controller.listar);
router.get('/:id', controller.buscar);
router.post('/', controller.criar);
router.put('/:id', controller.atualizar);
router.patch('/:id/inativar', controller.inativar);
router.delete('/:id', controller.excluir);

module.exports = router;
