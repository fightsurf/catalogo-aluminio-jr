const express = require('express');
const vendedoresController = require('../../../controllers/legado/vendedores/vendedores.controller');

const router = express.Router();

router.get('/', vendedoresController.listarVendedores);
router.get('/:favorecido', vendedoresController.buscarVendedor);
router.post('/', vendedoresController.criarVendedor);
router.put('/:favorecido', vendedoresController.atualizarVendedor);
router.delete('/:favorecido', vendedoresController.desativarVendedor);

module.exports = router;
