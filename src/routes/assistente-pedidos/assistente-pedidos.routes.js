const express = require('express');
const controller = require('../../controllers/assistente-pedidos/assistente-pedidos.controller');
const { requireAuth } = require('../../middlewares/adminAuth.middleware');
const router = express.Router();

router.get('/publico/:token/contexto', controller.contexto);
router.get('/publico/:token/produtos', controller.produtos);
router.get('/publico/:token/datas', controller.datas);
router.get('/publico/:token/transportadoras', controller.transportadoras);
router.post('/publico/:token/concluir', controller.concluir);

router.post('/admin/links', requireAuth, controller.gerarLink);
router.get('/admin/pre-pedidos', requireAuth, controller.listar);
router.get('/admin/pre-pedidos/:id', requireAuth, controller.detalhe);
router.post('/admin/pre-pedidos/:id/confirmar', requireAuth, controller.confirmar);

module.exports = router;
