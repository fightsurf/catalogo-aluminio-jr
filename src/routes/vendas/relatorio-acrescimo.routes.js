const express = require('express');
const router = express.Router();

const {
  processarRelatorioComAcrescimo
} = require('../../controllers/vendas/relatorio-acrescimo.controller');

router.post('/acrescimo', processarRelatorioComAcrescimo);

module.exports = router;
