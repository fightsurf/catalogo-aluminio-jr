'use strict';
const router=require('express').Router();
const path=require('path');
const {requireAuth}=require('../../middlewares/adminAuth.middleware');
const svc=require('../../services/mala-direta/mala-direta.service');
const multer=require('multer');
const gravador=require('../../services/mala-direta/mala-direta-audio-gravado.service');
const eleven=require('../../services/integracoes/elevenlabs-jr.service');
const uploadAudio=multer({storage:multer.memoryStorage(),limits:{fileSize:6*1024*1024,files:1,fields:0}}).single('audio');
router.use(requireAuth);
// Cada rota informa sua etapa de falha. Sem expor tokens ou credenciais.
const handler=(etapa,fn)=>async(req,res)=>{try{res.json({sucesso:true,dados:await fn(req)});}catch(e){
  console.error('[mala-direta/api]',etapa,e.stack||e.message);
  res.status(e.status||500).json({sucesso:false,
    mensagem:e.status?e.message:'Falha na etapa '+etapa+'.',
    detalhe:e.message, etapa});
}};
router.get('/produtos',handler('consulta de produtos (catálogo PostgreSQL Render)',req=>svc.produtos(req.query.busca)));
router.get('/carradas',handler('carradas (Firebird)',()=>svc.carradas()));
router.get('/semanas',handler('semanas (PostgreSQL)',()=>svc.semanas()));
router.post('/destinatarios',handler('clientes pelo critério escolhido',req=>svc.compradoresPorCriterio(req.body||{})));
router.get('/primeira-compra/:item',handler('consulta da primeira compra (Firebird)',req=>svc.primeiraCompra(req.params.item)));
router.get('/compradores/:item',handler('consulta de compradores (Firebird / bloqueios PostgreSQL)',req=>svc.compradores(req.params.item,req.query.meses)));
router.get('/campanhas',handler('histórico de campanhas (PostgreSQL)',()=>svc.listar()));
router.get('/campanhas/:id',handler('relatório de campanha (PostgreSQL)',req=>svc.detalhe(req.params.id)));
router.post('/campanhas',handler('criação de campanha',req=>svc.criar(req.body||{},`${req.protocol}://${req.get('host')}`,req.adminUser)));
router.post('/campanhas/:id/:acao',handler('alteração de campanha',req=>svc.mudarStatus(req.params.id,req.params.acao)));
router.post('/bloqueios',handler('bloqueio de telefone',req=>svc.bloquear(req.body?.telefone,req.body?.motivo)));
router.post('/teste',handler('envio de teste',req=>svc.enviarTeste(req.body||{},`${req.protocol}://${req.get('host')}`,req.adminUser)));
router.post('/audio-gravado',(req,res,next)=>{
  // Conferir a origem para impedir a preparação de arquivos via outros sites.
  const origin=req.get('origin');
  try{if(origin && new URL(origin).host!==req.get('host'))return res.status(403).json({sucesso:false,detalhe:'Origem não autorizada.'});}
  catch(_){return res.status(403).json({sucesso:false,detalhe:'Origem inválida.'});}
  uploadAudio(req,res,e=>{
    if(e)return res.status(e.code==='LIMIT_FILE_SIZE'?413:400).json({sucesso:false,detalhe:e.code==='LIMIT_FILE_SIZE'?'Gravação maior que 6 MB.':'Upload de áudio inválido.'});
    next();
  });
},async(req,res)=>{
  try{
    const audio=await gravador.converter(req.file);
    const previewId=eleven.salvarPreview(audio,req.adminUser);
    res.set('X-Preview-Id',previewId);
    res.set('Cache-Control','no-store');
    res.type('audio/mpeg').send(audio.bytes);
  }catch(e){res.status(e.status||500).json({sucesso:false,detalhe:e.message||'Falha no áudio gravado.'});}
});
// Diagnóstico de leitura; não dispara WhatsApp nem altera vendas.
router.get('/diagnostico', async(_req,res)=>{
  const pool=require('../../../db/connection');
  const checks={};
  try { const r=await pool.query('SELECT 1 AS ok'); checks.postgresql={ok:r.rows?.[0]?.ok===1}; }
  catch(e){ checks.postgresql={ok:false,erro:String(e.message).slice(0,280)}; }
  try { const r=await pool.query('SELECT COUNT(*)::int AS total FROM produtos'); checks.catalogoRender={ok:true,total:r.rows[0].total}; }
  catch(e){ checks.catalogoRender={ok:false,erro:String(e.message).slice(0,280)}; }
  res.json({sucesso:true,dados:checks});
});
module.exports=router;
