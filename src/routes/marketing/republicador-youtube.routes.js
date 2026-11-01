'use strict';
const express = require('express');
const { requireAuth } = require('../../middlewares/adminAuth.middleware');
const service = require('../../services/marketing/republicador-youtube.service');

const router = express.Router();
router.use(requireAuth);
router.get('/api/diagnostico', (_req,res) => res.json({ success:true, data:await service.diagnostico() }));

function tratar(fn) { return async(req,res)=> { try { await fn(req,res); }
  catch(e) { console.error('[Republicador YouTube]', String(e?.message||e).slice(0,500));
    res.status(400).json({ success:false, message:e.message||'Falha na operação' }); } }; }

router.get('/api/videos', tratar(async(req,res)=> {
  const data = await service.listar(String(req.query.pagina || ''));
  res.json({success:true,data});
}));
router.get('/api/jobs', tratar(async(_req,res)=>res.json({success:true,data:await service.historico()})));
router.get('/api/jobs/:id', tratar(async(req,res)=> {
  const job = await service.obter(req.params.id);
  if (!job) return res.status(404).json({success:false,message:'Publicação não encontrada'});
  res.json({success:true,data:service.paraCliente(job)});
}));
router.post('/api/jobs', tratar(async(req,res)=> {
  const {video_id, modo, request_id} = req.body || {};
  if (modo === 'publicar' && req.body?.confirmar !== 'PUBLICAR_NAS_TRES_REDES') {
    return res.status(400).json({success:false,message:'Confirme a publicação nas três redes sociais.'});
  }
  const job = await service.iniciar(video_id,modo,request_id);
  res.status(202).json({success:true,data:job});
}));
router.post('/api/jobs/:id/repetir', tratar(async(req,res)=> {
  if (req.body?.confirmar !== 'REPETIR_APENAS_PENDENTES') {
    return res.status(400).json({success:false,message:'Confirme a repetição dos destinos pendentes.'});
  }
  const job = await service.retry(req.params.id);
  res.status(202).json({success:true,data:job});
}));
module.exports = router;
