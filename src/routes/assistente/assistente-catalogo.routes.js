const express = require('express');
const assistenteAuth = require('../../middlewares/assistenteAuth.middleware');
const controller = require('../../controllers/assistente/assistente-catalogo.controller');

const router = express.Router();

router.use(assistenteAuth);

router.get('/resolver', controller.resolver);
router.post('/resolver', controller.resolver);

module.exports = router;
