const express = require('express');
const controller = require('../../../controllers/legado/pedido/pedidosLegado.controller');
const router = express.Router();
const { requireAuth } = require('../../../middlewares/adminAuth.middleware');
const resumoIA = require('../../../services/legado/pedido/resumo-pedido-ia.service');

router.get('/pedidos', controller.pesquisarPedidos);
router.post('/pedidos/:idMestre/resumo-ia', requireAuth, async (req, res) => {
  try {
    const data = await resumoIA.gerarResumo(req.params.idMestre, req.body?.tipo || 'automatico');
    return res.json({ success: true, data });
  } catch (error) {
    const status = error.status || 500;
    if (status >= 500) console.error('Resumo pedido IA:', error);
    return res.status(status).json({ success: false, erro: status === 500 ? 'Erro ao gerar resumo do pedido.' : error.message });
  }
});
router.get('/pedidos/:idMestre/itens', controller.buscarItensPedido);
router.get('/pedidos/:idMestre/carradas-disponiveis', controller.listarCarradasDisponiveis);
router.post('/pedidos/:idMestre/whatsapp/pdf', controller.enviarPdfWhatsappPedido);
router.post('/pedidos/:idMestre/calcular-volumes', controller.calcularVolumesPedido);
router.post('/pedidos/:idMestre/copiar', controller.copiarPedido);
router.post('/pedidos/:idMestre/particionar', controller.particionarPedido);
router.post('/pedidos/:idMestre/cancelar', controller.cancelarPedido);
router.put('/pedidos/:idMestre/carrada', controller.alterarCarradaPedido);
router.put('/pedidos/:idMestre/cliente', controller.alterarClientePedido);
router.put('/pedidos/:idMestre', controller.atualizarPedido);

module.exports = router;
