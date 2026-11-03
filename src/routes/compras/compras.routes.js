'use strict';
const express = require('express');
const multer = require('multer');
const service = require('../../services/compras/compras.service');
const ia = require('../../services/compras/comprasIa.service');
const router = express.Router();
const upload = multer({storage:multer.memoryStorage(),limits:{files:5,fileSize:7*1024*1024}}).array('imagens',5);
function receber(req,res,next) {
  upload(req,res,erro=>{
    if (!erro) return next();
    res.status(erro instanceof multer.MulterError ? 413 : 400)
      .json({erro:erro.code==='LIMIT_FILE_SIZE'?'Cada foto pode ter até 7 MB.':erro.message});
  });
}
function tratar(res,e) {
  if ((e.status||500) >= 500) console.error('[Compras]',e);
  res.status(e.status||500).json({erro:e.status ? e.message : 'Falha interna ao processar a compra.'});
}
router.get('/fornecedores',async (_req,res)=>{try{res.json(await service.fornecedores());}catch(e){tratar(res,e);}});
router.get('/insumos',async (_req,res)=>{try{res.json(await service.insumos());}catch(e){tratar(res,e);}});
router.post('/interpretar',receber,async(req,res)=>{try{res.json(await ia.interpretar(req.files));}catch(e){tratar(res,e);}});
router.get('/',async(req,res)=>{try{res.json(await service.listar(req.query));}catch(e){tratar(res,e);}});
router.get('/:id',async(req,res)=>{try{res.json(await service.buscar(req.params.id));}catch(e){tratar(res,e);}});
router.post('/',async(req,res)=>{try{res.status(201).json(await service.gravar(req.body));}catch(e){tratar(res,e);}});
router.put('/:id',async(req,res)=>{try{res.json(await service.gravar(req.body,req.params.id));}catch(e){tratar(res,e);}});
module.exports = router;
