const express = require('express');
const controller = require('../../../controllers/legado/carradas-progresso/carradas-progresso.controller');

const router = express.Router();

router.get('/resumo/lista', controller.buscarResumoListaCarradas);
router.get('/:codigo', controller.buscarMatriz);
router.post('/:codigo/whatsapp/lote', controller.enviarWhatsappCarradaLote);
router.post('/:codigo/pedidos/:numeroPedido/quantidade-volumes/calcular', controller.calcularQuantidadeVolumesPedido);
router.put('/:codigo/pedidos/:numeroPedido/quantidade-volumes', controller.salvarQuantidadeVolumesManual);
router.patch('/:codigo/pedidos/:numeroPedido/fases/:faseCodigo', controller.salvarFaseBooleana);
router.get('/:codigo/pedidos/:numeroPedido/etiqueta-volumes', controller.buscarDadosEtiquetaPedido);
router.post('/:codigo/pedidos/:numeroPedido/etiqueta-volumes', controller.enviarEtiquetaVolumes);
router.patch('/:codigo/pedidos/:numeroPedido/etiqueta-volumes/confirmacao', controller.confirmarEtiquetaVolumes);
router.put('/:codigo/pedidos/:numeroPedido/local-entrega', controller.salvarLocalEntrega);

module.exports = router;
