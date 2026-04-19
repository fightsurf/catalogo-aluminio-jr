const express = require('express');
const router = express.Router();
const controller = require('../../controllers/insumoCategoria/insumoCategoria.controller');

router.get('/', controller.listar);
router.get('/:id', controller.buscar);
router.post('/', controller.criar);
router.put('/:id', controller.atualizar);
router.delete('/:id', controller.excluir);

module.exports = router;
