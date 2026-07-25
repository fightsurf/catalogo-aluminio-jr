const express = require('express');
const path = require('path');
const { requireAuth } = require('../../middlewares/adminAuth.middleware');
const router = express.Router();
router.get('/central-ofertas', requireAuth, (req,res)=>res.sendFile(path.resolve(__dirname,'../../../views/ofertas/central-ofertas.html')));
router.get('/ofertas/:codigo', (req,res)=>res.sendFile(path.resolve(__dirname,'../../../views/ofertas/oferta-publica.html')));
module.exports = router;
