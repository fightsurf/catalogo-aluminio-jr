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

const funil = require('../../services/marketing/funilPublicacoes.service');
router.get('/agendamentos/funil', requireAuth, async (req,res) => {
  try { res.json({success:true,data:await funil.painel()}); }
  catch(e) {res.status(500).json({success:false,error:e.message});}
});
router.get('/agendamentos/funil/logs', requireAuth, async (req,res) => {
  try { res.json({success:true,data:await funil.buscarLogs(req.query||{})}); }
  catch(e) {res.status(400).json({success:false,error:e.message});}
});
router.get('/agendamentos/funil/itens/:id', requireAuth, async (req,res) => {
  try { const data=await funil.detalheItem(req.params.id);
    if(!data)return res.status(404).json({success:false,error:'Item não encontrado.'});
    res.json({success:true,data});
  } catch(e) {res.status(400).json({success:false,error:e.message});}
});
router.post('/agendamentos/funil/itens/:id/conciliar', requireAuth, async (req,res) => {
  try { res.json({success:true,data:await funil.resolverItem({...(req.body||{}),id:req.params.id})}); }
  catch(e) {res.status(400).json({success:false,error:e.message});}
});
router.post('/agendamentos/recuperar-legado/:id', requireAuth, async (req,res) => {
  try {res.json({success:true,data:await agendamentos.migrarLegado(req.params.id)});}
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
