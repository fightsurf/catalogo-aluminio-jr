'use strict';
const express = require('express');
const service = require('../../services/legado/pedidos-insercao-v2/promocao-posvenda.service');
const { requireAuth } = require('../../../middlewares/adminAuth.middleware');
const router = express.Router();
const tentativa = (fn) => async (req, res) => {
  try { return res.json({ sucesso: true, dados: await fn(req, res) }); }
  catch (e) {
    console.error('[promocao-posvenda]', e.message);
    return res.status(e.status || 500).json({ erro: e.status ? e.message : 'Falha interna ao processar promoção.' });
  }
};
router.use(requireAuth);
function origemValida(req, res, next) {
  const origin = req.get('origin');
  if (origin) {
    try {
      if (new URL(origin).host !== req.get('host')) return res.status(403).json({ erro: 'Origem não autorizada.' });
    } catch (_) { return res.status(403).json({ erro: 'Origem inválida.' }); }
  }
  next();
}
router.get('/produtos', tentativa(req => service.listarProdutos(req.query.busca || '')));
router.post('/texto-ia', origemValida, tentativa(req => service.gerarTexto(req.body)));
router.post('/agendar', origemValida, tentativa(req => service.agendar(req.body, req.adminUser)));
module.exports = router;
