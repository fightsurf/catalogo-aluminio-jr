const express = require('express');
const path = require('path');
const { requireAuth } = require('../../middlewares/adminAuth.middleware');
const sistemaAplicativos = require('../../services/sistema/sistemaAplicativos.service');

const router = express.Router();

router.get('/', requireAuth, (req, res) => {
  res.sendFile(path.resolve(__dirname, '../../../views/sistema/index.html'));
});

router.get('/api/apps', requireAuth, (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json(sistemaAplicativos.getSummary());
  } catch (err) {
    console.error('[sistema] erro ao montar catálogo:', err);
    res.status(500).json({ erro: 'Não foi possível montar o catálogo de aplicativos.' });
  }
});

module.exports = router;
