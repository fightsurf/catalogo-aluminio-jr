'use strict';
const express = require('express');
const path = require('path');
const { requireAuth } = require('../../middlewares/adminAuth.middleware');
const piloto = require('../../services/whatsapp/transcricoes-piloto.service');
const router = express.Router();

router.use(requireAuth);
router.get('/', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, '../../../views/whatsapp/transcricoes-piloto.html'));
});
router.get('/api', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ success: true, ...piloto.listar() });
});
module.exports = router;
