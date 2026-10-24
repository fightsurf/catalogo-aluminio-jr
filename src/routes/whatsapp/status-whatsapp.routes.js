const express = require('express');
const controller = require('../../controllers/whatsapp/status-whatsapp.controller');
const { requireAuth } = require('../../middlewares/adminAuth.middleware');

const router = express.Router();
const agendamentos = require('../../services/whatsapp/statusAgendamentos.service');
agendamentos.start();
router.get('/agendamentos', requireAuth, async (req,res) => {
  try { res.json({success:true,data:await agendamentos.obter()}); }
  catch(e){res.status(500).json({success:false,error:e.message});}
});
router.put('/agendamentos', requireAuth, async (req,res) => {
  try { res.json({success:true,data:await agendamentos.salvar(req.body||{})}); }
  catch(e){res.status(400).json({success:false,error:e.message});}
});

router.get('/conexao', requireAuth, controller.verificarConexao);
router.get('/categorias', requireAuth, controller.listarCategorias);
router.get('/produtos', requireAuth, controller.listarProdutos);
router.post('/produto', requireAuth, controller.enviarProduto);
router.get('/video-publicacao/:requestId', requireAuth, controller.consultarVideo);
router.post('/produto-status', requireAuth, controller.publicarProdutoNoStatus);
router.post('/categoria-facebook', requireAuth, controller.publicarCategoriaFacebook);

module.exports = router;
