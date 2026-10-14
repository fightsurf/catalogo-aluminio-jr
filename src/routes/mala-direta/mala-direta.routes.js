'use strict';
const router=require('express').Router();
const path=require('path');
const {requireAuth}=require('../../middlewares/adminAuth.middleware');
const svc=require('../../services/mala-direta/mala-direta.service');
router.use(requireAuth);
// Cada rota informa sua etapa de falha. Sem expor tokens ou credenciais.
const handler=(etapa,fn)=>async(req,res)=>{try{res.json({sucesso:true,dados:await fn(req)});}catch(e){
  console.error('[mala-direta/api]',etapa,e.stack||e.message);
  res.status(e.status||500).json({sucesso:false,
    mensagem:e.status?e.message:'Falha na etapa '+etapa+'.',
    detalhe:e.message, etapa});
}};
router.get('/produtos',handler('consulta de produtos (catálogo PostgreSQL Render)',req=>svc.produtos(req.query.busca)));
router.get('/primeira-compra/:item',handler('consulta da primeira compra (Firebird)',req=>svc.primeiraCompra(req.params.item)));
router.get('/compradores/:item',handler('consulta de compradores (Firebird / bloqueios PostgreSQL)',req=>svc.compradores(req.params.item,req.query.meses)));
router.get('/campanhas',handler('histórico de campanhas (PostgreSQL)',()=>svc.listar()));
router.get('/campanhas/:id',handler('relatório de campanha (PostgreSQL)',req=>svc.detalhe(req.params.id)));
router.post('/campanhas',handler('criação de campanha',req=>svc.criar(req.body||{},`${req.protocol}://${req.get('host')}`)));
router.post('/campanhas/:id/:acao',handler('alteração de campanha',req=>svc.mudarStatus(req.params.id,req.params.acao)));
router.post('/bloqueios',handler('bloqueio de telefone',req=>svc.bloquear(req.body?.telefone,req.body?.motivo)));
router.post('/teste',handler('envio de teste',req=>svc.enviarTeste(req.body?.telefone,req.body?.imagem,req.body?.mensagem,`${req.protocol}://${req.get('host')}`)));
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
