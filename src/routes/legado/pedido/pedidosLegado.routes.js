const express = require('express');
const controller = require('../../../controllers/legado/pedido/pedidosLegado.controller');
const router = express.Router();
const { requireAuth } = require('../../../middlewares/adminAuth.middleware');
const resumoIA = require('../../../services/legado/pedido/resumo-pedido-ia.service');
const vozResumoIA = require('../../../services/legado/pedido/resumo-pedido-voz-config.service');

// Preferência de voz exclusiva para a apresentação de pedidos, compartilhada entre telas e sessões.
router.get('/pedidos/resumo-ia/config-voz', requireAuth, async (req, res) => {
  try { return res.json({success:true,data:await vozResumoIA.obter()}); }
  catch (error) {
    console.error('Consultar voz do resumo:', error);
    return res.status(error.status || 500).json({success:false,erro:error.status ? error.message : 'Não foi possível consultar a configuração de voz.'});
  }
});
router.put('/pedidos/resumo-ia/config-voz', requireAuth, async (req, res) => {
  const origin = req.get('origin');
  if (origin) {
    try {
      if (new URL(origin).host !== req.get('host')) return res.status(403).json({success:false,erro:'Origem não autorizada.'});
    } catch (_) { return res.status(403).json({success:false,erro:'Origem inválida.'}); }
  }
  try { return res.json({success:true,data:await vozResumoIA.salvar(req.body)}); }
  catch (error) {
    if (!error.status || error.status >= 500) console.error('Salvar voz do resumo:', error);
    return res.status(error.status || 500).json({success:false,erro:error.status ? error.message : 'Não foi possível salvar a configuração de voz.'});
  }
});
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
