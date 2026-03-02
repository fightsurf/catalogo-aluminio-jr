const express = require('express');
const router = express.Router();
const controller = require('../../controllers/volume/adminVolume.controller');

router.get('/produtos', controller.listar);
router.patch('/produtos/:id/volume', controller.atualizarVolume);

module.exports = router;
