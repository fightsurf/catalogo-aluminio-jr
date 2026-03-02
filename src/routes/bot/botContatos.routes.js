const express = require('express');
const router = express.Router();
const controller = require('../../controllers/bot/botContatos.controller');

router.get('/contatos', controller.listarContatos);
router.put('/contatos/:id', controller.atualizarContato);

module.exports = router;
