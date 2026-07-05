const express = require('express');
const path = require('path');

const router = express.Router();
const VIEWS = path.join(__dirname, '..', 'views');

router.get('/', (req, res) => {
  res.sendFile(path.join(VIEWS, 'mirian-inicio.html'));
});

router.get('/paciente', (req, res) => {
  res.sendFile(path.join(VIEWS, 'mirian-paciente.html'));
});

router.get('/agente', (req, res) => {
  res.sendFile(path.join(VIEWS, 'mirian-agente.html'));
});

router.get('/admin', (req, res) => {
  res.sendFile(path.join(VIEWS, 'mirian-admin.html'));
});

module.exports = router;
