const express = require('express');
const multer = require('multer');
const { requireAuth } = require('../../middlewares/adminAuth.middleware');
const router = express.Router();
const uploadNotas = multer({
  storage: multer.memoryStorage(),
  limits: { files: 5, fileSize: 7 * 1024 * 1024 }
}).array('imagens', 5);
function receberFotos(req, res, next) {
  uploadNotas(req, res, (err) => {
    if (!err) return next();
    return res.status(err instanceof multer.MulterError ? 413 : 400)
      .json({ success: false, message: err.code === 'LIMIT_FILE_SIZE'
        ? 'Cada imagem deve ter no máximo 7 MB.' : 'Erro ao receber imagens: ' + err.message });
  });
}
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

// Leitura por IA e lançamento revisado: acesso administrativo obrigatório.
router.post('/:id/interpretar-nota', requireAuth, receberFotos, ctrl.interpretarNota);
router.post('/:id/itens/importar', requireAuth, ctrl.importarItens);

// Itens
router.post('/:id/itens', ctrl.criarItem);
router.put('/:id/itens/:itemId', ctrl.atualizarItem);
router.delete('/:id/itens/:itemId', ctrl.deletarItem);

// Pagamentos
router.post('/:id/pagamentos', ctrl.criarPagamento);
router.put('/:id/pagamentos/:pagamentoId', ctrl.atualizarPagamento);
router.delete('/:id/pagamentos/:pagamentoId', ctrl.deletarPagamento);

module.exports = router;
