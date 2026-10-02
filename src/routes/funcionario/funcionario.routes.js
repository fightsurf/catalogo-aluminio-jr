const express = require('express');
const router = express.Router();
const controller = require('../../controllers/funcionario/funcionario.controller');

router.get('/', controller.listar);
router.get('/:id', controller.buscarPorId);
router.post('/', controller.criar);
router.put('/:id', controller.atualizar);
router.patch('/:id/status', controller.alterarStatus);
router.delete('/:id', controller.remover);

module.exports = router;
