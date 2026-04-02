const express = require('express');
const controller = require('../../controllers/hub/hub.controller');

const router = express.Router();

router.get('/', controller.abrirPaginaHub);
router.get('/api/config', controller.obterConfigHub);

module.exports = router;
