const express = require('express');
const controller = require('../../../controllers/legado/dashboard-pedidos/dashboard-pedidos.view.controller');

const router = express.Router();

router.get('/', controller.abrirPaginaDashboardPedidos);

module.exports = router;
