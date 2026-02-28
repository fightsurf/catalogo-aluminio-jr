const express = require('express');
const router = express.Router();
const controller = require('../../controllers/volume/volume.controller');

router.post('/calcular', controller.calcular);

module.exports = router;
