const express = require('express');
const controller = require('../../../controllers/legado/clientes-creditos/clientes-creditos.controller');

const { requireAuth } = require('../../../middlewares/adminAuth.middleware');

const router = express.Router();

router.get('/', controller.listarClientes);
router.get('/:favorecido/extrato', controller.buscarExtrato);
router.get('/:favorecido/extrato/whatsapp/previa', requireAuth, controller.prepararWhatsappExtrato);
router.post('/:favorecido/extrato/whatsapp', requireAuth, controller.enviarWhatsappExtrato);
router.put('/:favorecido/lancamentos/:lancamentoId', controller.atualizarLancamento);
router.post('/:favorecido/ajustes', controller.registrarAjusteCliente);
router.post('/:favorecido/dividas', controller.registrarDividaAvulsa);
router.post('/:favorecido/pagamentos', controller.registrarPagamentoCliente);

module.exports = router;
