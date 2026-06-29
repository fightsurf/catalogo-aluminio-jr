const express = require('express');
const assistenteAuth = require('../../middlewares/assistenteAuth.middleware');
const controller = require('../../controllers/assistente/assistente-produtos.controller');

const router = express.Router();

router.use(assistenteAuth);

router.get('/consultar', controller.consultar);
router.post('/consultar', controller.consultar);
router.get('/buscar', controller.consultar);
router.post('/buscar', controller.consultar);

module.exports = router;
