const express = require('express');
const controller = require('../../controllers/admin/sql-terminal.controller');

const router = express.Router();

router.post('/query', controller.executarConsulta);

module.exports = router;
