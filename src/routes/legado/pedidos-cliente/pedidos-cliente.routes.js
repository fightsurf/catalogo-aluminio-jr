const express = require('express');
const router = express.Router();
const { requireAuth } = require('../../../middlewares/adminAuth.middleware');
const embutirValorLote = require('../../../services/legado/pedidos-cliente/embutir-valor-lote.service');

const pedidosClienteController = require('../../../controllers/legado/pedidos-cliente/pedidos-cliente.controller');


function executarRateio(acao) {
  return async (req, res) => {
    const origin = req.get('origin');
    if (origin) {
      try {
        if (new URL(origin).host !== req.get('host')) return res.status(403).json({sucesso:false,mensagem:'Origem não autorizada.'});
      } catch (_) {
        return res.status(403).json({sucesso:false,mensagem:'Origem inválida.'});
      }
    }
    try {
      const dados = await embutirValorLote[acao](req.params.favorecido, req.body || {});
      return res.json({sucesso:true,dados});
    } catch (error) {
      return res.status(400).json({sucesso:false,mensagem:error.message || 'Não foi possível processar o valor embutido.'});
    }
  };
}
router.post('/:favorecido/embutir-valor/previa', requireAuth, executarRateio('previa'));
router.post('/:favorecido/embutir-valor/aplicar', requireAuth, executarRateio('aplicar'));

router.get('/:favorecido/perfil-compras', pedidosClienteController.buscarPerfilCompras);
router.get('/:favorecido/precos-historicos', pedidosClienteController.buscarPrecosHistoricos);
router.get('/:favorecido', pedidosClienteController.listarPedidosPorCliente);
router.post('/:favorecido/whatsapp/resumo-imagem', pedidosClienteController.enviarResumoImagemWhatsapp);

module.exports = router;
