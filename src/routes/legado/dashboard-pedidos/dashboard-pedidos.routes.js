const express = require('express');
const controller = require('../../../controllers/legado/dashboard-pedidos/dashboard-pedidos.controller');

const router = express.Router();

router.get('/', controller.obterDashboardPedidos);

module.exports = router;
