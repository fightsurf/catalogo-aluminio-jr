const express = require('express');
const controller = require('../../controllers/whatsapp/whatsapp.controller');

const router = express.Router();

router.post('/enviar', controller.enviar);

module.exports = router;
