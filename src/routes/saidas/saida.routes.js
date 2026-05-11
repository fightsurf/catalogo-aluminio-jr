const express = require('express');
const router = express.Router();
const controller = require('../../controllers/saidas/saida.controller');

router.get('/relatorio-mensal', controller.relatorioMensal);
router.get('/faltantes-recorrentes', controller.faltantesRecorrentes);
router.get('/comparativo-mes', controller.comparativoMes);

router.get('/', controller.listar);
router.get('/:id', controller.buscar);
router.post('/', controller.criar);
router.put('/:id', controller.atualizar);
router.delete('/:id', controller.excluir);

module.exports = router;
