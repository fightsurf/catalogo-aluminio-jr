const express = require('express');
const router = express.Router();

// 🔥 CAMINHO CORRIGIDO
const controller = require('../../controllers/logistica/transportadorasController');

router.get('/', controller.listar);
router.post('/', controller.criar);
router.put('/:id', controller.atualizar);
router.patch('/:id/telefone-principal', controller.atualizarTelefonePrincipal);
router.delete('/:id', controller.deletar);

module.exports = router;
