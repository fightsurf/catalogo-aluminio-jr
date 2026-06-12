const express = require('express');
const controller = require('../../../controllers/legado/semanas/semanas.controller');

const router = express.Router();

router.get('/carradas/disponiveis', controller.listarCarradasDisponiveis);
router.get('/:id/resumo', controller.buscarResumoSemana);
router.post('/:id/whatsapp/lote', controller.enviarWhatsappSemanaLote);
router.get('/:id', controller.buscarSemanaPorId);
router.get('/', controller.listarSemanas);
router.post('/proxima', controller.criarProximaSemana);
router.post('/', controller.criarSemana);
router.put('/:id', controller.atualizarSemana);
router.delete('/:id', controller.excluirSemana);

module.exports = router;
