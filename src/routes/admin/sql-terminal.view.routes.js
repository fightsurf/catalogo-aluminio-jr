const express = require('express');
const controller = require('../../controllers/admin/sql-terminal.controller');

const router = express.Router();

router.get('/', controller.abrirPagina);

module.exports = router;
