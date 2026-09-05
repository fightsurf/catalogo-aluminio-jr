const express = require('express');
const controller = require('../../controllers/status-videos/status-videos.view.controller');
const { requireAuth } = require('../../middlewares/adminAuth.middleware');

const router = express.Router();
router.get('/', requireAuth, controller.abrirPagina);
module.exports = router;
