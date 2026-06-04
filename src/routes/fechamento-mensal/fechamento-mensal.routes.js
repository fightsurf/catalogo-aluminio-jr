const express = require('express');
const controller = require('../../controllers/fechamento-mensal/fechamento-mensal.controller');

const router = express.Router();

router.get('/', controller.carregar);

module.exports = router;
