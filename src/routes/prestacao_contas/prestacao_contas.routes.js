const express = require('express');
const router = express.Router();
const ctrl = require('../../controllers/prestacao_contas/prestacao_contas.controller');

// Prestações
router.get('/', ctrl.listar);
router.get('/painel-saldos', ctrl.painelSaldos);
router.post('/', ctrl.criar);
router.get('/:id/resumo', ctrl.resumo);
router.post('/:id/whatsapp/resumo', ctrl.enviarResumoWhatsapp);
router.post('/:id/whatsapp/pdf', ctrl.enviarPdfWhatsapp);
router.patch('/:id/concluir', ctrl.concluir);
router.patch('/:id/reabrir', ctrl.reabrir);
router.get('/:id', ctrl.buscarPorId);
router.put('/:id', ctrl.atualizar);
router.delete('/:id', ctrl.deletar);

// Itens
router.post('/:id/itens', ctrl.criarItem);
router.put('/:id/itens/:itemId', ctrl.atualizarItem);
router.delete('/:id/itens/:itemId', ctrl.deletarItem);

// Pagamentos
router.post('/:id/pagamentos', ctrl.criarPagamento);
router.delete('/:id/pagamentos/:pagamentoId', ctrl.deletarPagamento);

module.exports = router;
