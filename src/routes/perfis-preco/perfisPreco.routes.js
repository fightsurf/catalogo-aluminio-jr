'use strict';
const express = require('express');
const service = require('../../services/perfis-preco/perfisPreco.service');
const {requireAuth} = require('../../middlewares/adminAuth.middleware');
const router = express.Router();

function erro(res,e) { return res.status(e.status || (/inválido|informe|indisponível|limite|obrigatório|máximo|selecion/i.test(e.message) ? 400 : 500)).json({success:false,message:e.status === 500 ? 'Erro interno.' : e.message}); }
const wrap = fn => (req,res) => Promise.resolve(fn(req,res)).catch(e => {console.error('[perfis-preco]',e.message);erro(res,e);});
function adminOrigin(req,res,next) {
  // Sem cookies de terceiros, e operação administrativa apenas da mesma origem.
  const origin = req.get('origin');
  if (origin) {
    let host;
    try { host = new URL(origin).host; } catch(_) { return res.status(403).json({success:false,message:'Origem inválida.'}); }
    if (host !== req.get('host')) return res.status(403).json({success:false,message:'Origem não permitida.'});
  }
  next();
}
router.get('/t/:token/produtos', wrap(async (req,res) => {
  const tipo = String(req.query.tipo || '');
  const data = await service.listarProdutos(req.params.token,tipo);
  res.set('Cache-Control','no-store');
  res.set('Referrer-Policy','no-referrer');
  res.json({success:true,data:data.produtos,perfil:data.perfil});
}));
router.post('/t/:token/enviar', express.json({limit:'40kb'}), wrap(async(req,res) => {
  res.set('Cache-Control','no-store');
  const resultado = await service.enviar(req.params.token,req.body || {});
  res.status(resultado.concluido ? 200 : 207).json({success:resultado.concluido,data:resultado,
    message:resultado.concluido ? 'As mensagens foram aceitas pela Z-API.' : 'Envio parcial ou incerto. Não repita como pedido novo; consulte a administração.'});
}));
router.use('/admin',requireAuth,adminOrigin);
router.get('/admin', wrap(async(req,res)=>res.json({success:true,data:await service.listarAdmin()})));
router.get('/admin/envios', wrap(async(req,res)=>res.json({success:true,data:await service.historico()})));
router.post('/admin', wrap(async(req,res)=>res.status(201).json({success:true,data:await service.criarAdmin(req.body)})));
router.put('/admin/:id', wrap(async(req,res)=>res.json({success:true,data:await service.atualizarAdmin(req.params.id,req.body)})));
router.post('/admin/:id/regenerar-token', wrap(async(req,res)=>res.json({success:true,data:await service.regenerarToken(req.params.id)})));
module.exports = router;
