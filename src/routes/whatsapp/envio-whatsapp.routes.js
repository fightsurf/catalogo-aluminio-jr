const express = require('express');
const controller = require('../../controllers/whatsapp/envio-whatsapp.controller');

const router = express.Router();

const controle = require('../../services/whatsapp/central-controle.service');
// Endpoints por funcionalidade: a origem é definida no servidor.
const tag = id => (req,res,next) => controle.comFuncionalidade(id,next);
router.post('/enviar-pedido', tag('pedidos_texto'), controller.enviarMensagem);
router.post('/enviar-cliente-financeiro', tag('pedidos_historico_financeiro'), controller.enviarMensagem);
router.post('/enviar-pagamento', tag('pagamentos_mensagens'), controller.enviarMensagem);
router.post('/enviar-progresso', tag('progresso_mensagem_cliente'), controller.enviarMensagem);
router.post('/enviar', controller.enviarMensagem);

module.exports = router;
