const express = require('express');
const router = express.Router();
const controller = require('../../controllers/bot/botAutonomia.controllers');

router.get('/status', controller.getStatus);
router.post('/status', controller.setStatus);

module.exports = router;
