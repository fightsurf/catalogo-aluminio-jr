const express = require('express');
const controller = require('../../../controllers/legado/semanas/semanas.controller');
const { requireAuth } = require('../../../middlewares/adminAuth.middleware');

const router = express.Router();

router.get('/carradas/disponiveis', controller.listarCarradasDisponiveis);
router.get('/dashboard/indice', controller.listarIndiceSemanasDashboard);
router.get('/:id/resumo', controller.buscarResumoSemana);
router.get('/:id/fornecedores', requireAuth, controller.listarFornecedoresResumo);
router.put('/:id/fornecedores', requireAuth, controller.salvarFornecedoresResumo);
router.get('/:id/fornecedores/:fornecedorId/whatsapp', requireAuth, controller.visualizarWhatsappFornecedor);
router.post('/:id/fornecedores/:fornecedorId/whatsapp', requireAuth, controller.enviarWhatsappFornecedor);
router.post('/:id/whatsapp/lote', controller.enviarWhatsappSemanaLote);
router.get('/:id', controller.buscarSemanaPorId);
router.get('/', controller.listarSemanas);
router.post('/proxima', controller.criarProximaSemana);
router.post('/', controller.criarSemana);
router.put('/:id', controller.atualizarSemana);
router.delete('/:id', controller.excluirSemana);

module.exports = router;
