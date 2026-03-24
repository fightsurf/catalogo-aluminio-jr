const express = require('express');
const router = express.Router();

const {
  abrirPaginaRelatorioAcrescimo
} = require('../../controllers/vendas/relatorio-acrescimo.view.controller');

router.get('/relatorio-acrescimo', abrirPaginaRelatorioAcrescimo);

module.exports = router;
