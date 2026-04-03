const express = require('express');
const controller = require('../../controllers/hub/hub.controller');

const router = express.Router();

router.get('/', controller.abrirPaginaHub);
router.get('/config', controller.obterConfig);
router.put('/config', controller.salvarConfig);

module.exports = router;
