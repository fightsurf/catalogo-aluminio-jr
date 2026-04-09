const express = require('express');
const router = express.Router();
const controller = require('../../controllers/combinador/combinador.view.controller');

router.get('/', controller.page);

module.exports = router;
