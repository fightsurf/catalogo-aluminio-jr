const express = require('express');
const controller = require('../../controllers/whatsapp/relatorios-recebidos.controller');
const n8nAuth = require('../../middlewares/n8nAuth.middleware');
const { requireAuth } = require('../../middlewares/adminAuth.middleware');

const router = express.Router();

// Recebimento automático vindo exclusivamente do n8n.
router.post('/', n8nAuth, controller.salvar);

// Consulta e exclusão somente para usuário administrativo autenticado.
router.get('/', requireAuth, controller.listar);
router.delete('/:id', requireAuth, controller.excluir);

module.exports = router;
