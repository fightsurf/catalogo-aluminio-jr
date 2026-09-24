const express = require('express');
const controller = require('../../controllers/whatsapp/relatorios-recebidos.controller');
const n8nAuth = require('../../middlewares/n8nAuth.middleware');
const { requireAuth } = require('../../middlewares/adminAuth.middleware');

const router = express.Router();

// O n8n envia a mensagem recebida; o backend decide se é relatório.
router.post('/capturar', n8nAuth, controller.capturar);

// Consulta e exclusão apenas para usuário administrativo autenticado.
router.get('/', requireAuth, controller.listar);
router.delete('/:id', requireAuth, controller.excluir);

module.exports = router;
