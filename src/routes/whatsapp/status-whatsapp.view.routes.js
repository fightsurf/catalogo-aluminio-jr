const express = require('express');
const path = require('path');
const controller = require('../../controllers/whatsapp/status-whatsapp.view.controller');
const { requireAuth } = require('../../middlewares/adminAuth.middleware');

const router = express.Router();

router.get('/status', requireAuth, controller.abrirPaginaStatusWhatsapp);
router.get('/status/agendamentos', requireAuth, (_req,res) => {
  res.sendFile(path.resolve(__dirname,'../../../views/whatsapp/status-agendamentos.html'));
});

module.exports = router;
