'use strict';

const express = require('express');
const path = require('path');
const { requireAuth } = require('../../middlewares/adminAuth.middleware');
const controle = require('../../services/whatsapp/central-controle.service');
const router = express.Router();

router.use(requireAuth);
router.get('/', (_req,res)=>res.sendFile(path.join(__dirname,'../../../views/whatsapp/central-controle.html')));
router.get('/api/controles', async (_req,res)=>{
  try {
    res.set('Cache-Control','no-store');
    return res.json({success:true,controles:await controle.listar()});
  } catch(error){
    console.error('[Central WhatsApp] Consulta de controles:',error.message);
    return res.status(500).json({success:false,message:'Falha ao consultar os controles.'});
  }
});
router.put('/api/controles/:id', async (req,res)=>{
  const origin=req.get('origin');
  if (origin) {
    try { if (new URL(origin).host!==req.get('host')) return res.status(403).json({success:false,message:'Origem não autorizada.'}); }
    catch(_){return res.status(403).json({success:false,message:'Origem inválida.'});}
  }
  try {
    const resultado=await controle.alterar(req.params.id,req.body?.ativo,req.adminUser);
    res.set('Cache-Control','no-store');
    return res.json({success:true,resultado});
  }catch(error){
    if (!error.status||error.status>=500) console.error('[Central WhatsApp] Alteração:',error.message);
    return res.status(error.status||500).json({success:false,message:error.status?error.message:'Falha ao salvar controle.'});
  }
});
module.exports=router;
