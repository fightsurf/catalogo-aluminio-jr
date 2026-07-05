const express = require('express');
const mirianController = require('../controllers/mirian.controller');

const router = express.Router();

router.get('/sintomas', mirianController.listarSintomas);
router.post('/sintomas', mirianController.criarSintoma);
router.patch('/sintomas/:id', mirianController.atualizarSintoma);
router.delete('/sintomas/:id', mirianController.excluirSintoma);

router.get('/pacientes', mirianController.listarPacientes);
router.post('/pacientes', mirianController.criarPaciente);
router.patch(
  '/pacientes/:id/visitado',
  mirianController.atualizarPacienteVisitado
);

router.post(
  '/pacientes/:id/whatsapp',
  mirianController.enviarMensagemWhatsappPaciente
);

module.exports = router;
