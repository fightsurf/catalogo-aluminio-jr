const express = require('express');
const controller = require('../../../controllers/legado/carradas-progresso/carradas-progresso.controller');

const router = express.Router();

router.get('/resumo/lista', controller.buscarResumoListaCarradas);
router.get('/:codigo', controller.buscarMatriz);
router.post('/:codigo/whatsapp/lote', controller.enviarWhatsappCarradaLote);
router.post('/:codigo/pedidos/:numeroPedido/quantidade-volumes/calcular', controller.calcularQuantidadeVolumesPedido);
router.put('/:codigo/pedidos/:numeroPedido/quantidade-volumes', controller.salvarQuantidadeVolumesManual);
router.patch('/:codigo/pedidos/:numeroPedido/data-expedicao', controller.salvarDataExpedicao);
router.patch('/:codigo/pedidos/:numeroPedido/fases/:faseCodigo', controller.salvarFaseBooleana);
router.get('/:codigo/pedidos/:numeroPedido/etiqueta-impressao', controller.buscarDadosEtiquetaImpressao);
router.post('/:codigo/pedidos/:numeroPedido/etiqueta-impressao/preview', controller.gerarPreviewEtiquetaImpressao);
router.post('/:codigo/pedidos/:numeroPedido/etiqueta-impressao/whatsapp', controller.enviarEtiquetaImpressaoWhatsapp);
router.put('/:codigo/pedidos/:numeroPedido/etiqueta-perfil', controller.salvarPerfilEtiquetaPedido);
router.get('/:codigo/pedidos/:numeroPedido/etiqueta-volumes', controller.buscarDadosEtiquetaPedido);
router.post('/:codigo/pedidos/:numeroPedido/etiqueta-volumes', controller.enviarEtiquetaVolumes);
router.patch('/:codigo/pedidos/:numeroPedido/etiqueta-volumes/confirmacao', controller.confirmarEtiquetaVolumes);
router.put('/:codigo/pedidos/:numeroPedido/local-entrega', controller.salvarLocalEntrega);
router.get('/:codigo/pedidos/:numeroPedido/local-entrega/historico', controller.buscarHistoricoLocalEntrega);
router.post('/:codigo/pedidos/:numeroPedido/local-entrega/perguntar-repeticao', controller.perguntarRepeticaoLocalEntrega);

module.exports = router;
