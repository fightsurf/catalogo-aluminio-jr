const express = require('express');
const controller = require('../../controllers/whatsapp/relatorios-recebidos.controller');
const n8nAuth = require('../../middlewares/n8nAuth.middleware');
const { requireAuth } = require('../../middlewares/adminAuth.middleware');

const router = express.Router();

router.post('/capturar', n8nAuth, controller.capturar);
router.get('/', requireAuth, controller.listar);
router.get('/:id', requireAuth, controller.obter);
router.delete('/:id', requireAuth, controller.excluir);

module.exports = router;
