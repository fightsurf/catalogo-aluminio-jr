'use strict';
const express = require('express');
const service = require('../../services/legado/pedidos-insercao-v2/promocao-posvenda.service');
const router = express.Router();
const tentativa = (fn) => async (req, res) => {
  try { return res.json({ sucesso: true, dados: await fn(req, res) }); }
  catch (e) {
    console.error('[promocao-posvenda]', e.message);
    return res.status(e.status || 500).json({ erro: e.status ? e.message : 'Falha interna ao processar promoção.' });
  }
};
router.post('/desbloquear', tentativa(req => ({ token: service.desbloquear(req.body?.codigo, req.ip) })));
router.use(service.exigirToken);
router.get('/produtos', tentativa(req => service.listarProdutos(req.query.busca || '')));
router.post('/agendar', tentativa(req => service.agendar(req.body)));
module.exports = router;
