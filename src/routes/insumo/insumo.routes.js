const express = require('express');
const router = express.Router();
const controller = require('../../controllers/insumo/insumo.controller');

router.get('/', controller.listar);
router.get('/todos', controller.listarTodos);
router.get('/:id', controller.buscar);
router.post('/', controller.criar);
router.put('/:id', controller.atualizar);
router.delete('/:id', controller.excluir);

module.exports = router;
