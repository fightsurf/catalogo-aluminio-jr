const express = require('express');
const controller = require('../../../controllers/legado/cheques/cheques.controller');

const router = express.Router();

router.get('/', controller.listarCheques);

module.exports = router;
