const express = require('express');
const controller = require('../../controllers/whatsapp/status-whatsapp.view.controller');
const { requireAuth } = require('../../middlewares/adminAuth.middleware');

const router = express.Router();

router.get('/status', requireAuth, controller.abrirPaginaStatusWhatsapp);

module.exports = router;
