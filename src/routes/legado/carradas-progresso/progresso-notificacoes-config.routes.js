'use strict';
const express=require('express');
const svc=require('../../../services/legado/carradas-progresso/progresso-notificacoes-config.service');
const eleven=require('../../../services/integracoes/elevenlabs-jr.service');
const {requireAuth}=require('../../../middlewares/adminAuth.middleware');
const router=express.Router();
router.use(requireAuth);
function falha(res,e){res.status(Number(e.statusCode||e.status)||500).json({success:false,message:e.message||'Erro nas configurações de progresso.'});}
function seguro(fn){return async(req,res)=>{try{res.json({success:true,data:await fn(req,res)});}catch(e){falha(res,e)}}}
function mesmaOrigem(req,res,next){const origem=req.get('origin');if(origem){try{if(new URL(origem).host!==req.get('host'))return res.status(403).json({success:false,message:'Origem não autorizada.'});}catch{return res.status(403).json({success:false,message:'Origem inválida.'});}}next();}
router.get('/',seguro(()=>svc.listar()));
router.put('/geral',mesmaOrigem,seguro(req=>svc.salvarGeral(req.body||{})));
router.put('/fases/:fase',mesmaOrigem,seguro(req=>svc.salvarFase(req.params.fase,req.body||{})));
router.get('/elevenlabs/vozes',seguro(()=>eleven.listarVozes()));
router.get('/elevenlabs/modelos',seguro(()=>eleven.listarModelos()));
router.post('/fases/:fase/gerar-audio',mesmaOrigem,seguro(req=>svc.gerarESalvar(req.params.fase,req.body||{})));
router.post('/fases/:fase/gravar-audio',mesmaOrigem,express.raw({type:['audio/webm','audio/ogg','audio/mp4','audio/mpeg','audio/mp3'],limit:'5mb'}),seguro(req=>svc.salvarGravacao(req.params.fase,req.body,req.get('content-type')||'')));
router.get('/fases/:fase/audio',async(req,res)=>{try{
  const f=await svc.fase(req.params.fase);
  if(!f.audio_chave)return res.status(404).json({message:'Esta fase ainda não possui áudio salvo.'});
  const bytes=await svc.obterAudioBytes(f.audio_chave);
  res.set({'Content-Type':'audio/mpeg','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}).send(bytes);
}catch(e){falha(res,e)}});
router.delete('/fases/:fase/audio',mesmaOrigem,seguro(req=>svc.excluirAudio(req.params.fase)));
module.exports=router;
