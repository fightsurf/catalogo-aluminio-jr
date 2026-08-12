const express = require('express');
const controller = require('../../controllers/logistica/agenciasRecebimentoController');

const router = express.Router();

router.get('/', controller.listar);
router.get('/:codigo', controller.buscar);
router.post('/', controller.criar);
router.put('/:codigo', controller.atualizar);
router.delete('/:codigo', controller.deletar);

module.exports = router;
