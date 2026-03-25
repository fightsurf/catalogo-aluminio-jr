const express = require('express');
const itensViewController = require('../../../controllers/legado/itens/itens.view.controller');

const router = express.Router();

router.get('/', itensViewController.abrirPaginaItens);

module.exports = router;
