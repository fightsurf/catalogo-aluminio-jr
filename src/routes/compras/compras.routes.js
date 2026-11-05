'use strict';
const express = require('express');
const multer = require('multer');
const service = require('../../services/compras/compras.service');
const ia = require('../../services/compras/comprasIa.service');
const router = express.Router();
// Arquivos transitam apenas em memória: PDF único (até 12 MB) ou até 5 imagens (até 7 MB cada).
const upload = multer({storage:multer.memoryStorage(),limits:{files:5,fileSize:12*1024*1024}}).array('imagens',5);
function receber(req,res,next) {
  upload(req,res,erro=>{
    if (!erro) return next();
    res.status(erro instanceof multer.MulterError ? 413 : 400)
      .json({erro:erro.code==='LIMIT_FILE_SIZE'?'Arquivo acima de 12 MB. PDFs aceitam até 12 MB e fotos até 7 MB.':erro.message});
  });
}
function tratar(res,e) {
  if ((e.status||500) >= 500) console.error('[Compras]',e);
  res.status(e.status||500).json({erro:e.status ? e.message : 'Falha interna ao processar a compra.'});
}
router.get('/fornecedores',async (_req,res)=>{try{res.json(await service.fornecedores());}catch(e){tratar(res,e);}});
router.get('/insumos',async (_req,res)=>{try{res.json(await service.insumos());}catch(e){tratar(res,e);}});
// Importação IA localiza fornecedor+NF e completa o cadastro automaticamente.
router.post('/interpretar', receber, async (req,res) => {
  try {
    const resultado=await ia.interpretar(req.files);
    const dados=resultado.dados;
    const fornecedorInformado=String(req.body?.fornecedor_id || '').trim();
    const numeroInformado=String(req.body?.numero_nf || '').trim();
    const fornecedorDetectado=dados.fornecedor_id ? String(dados.fornecedor_id) : '';
    const numeroDetectado=String(dados.numero_nf || '').trim();
    const conflitanteFornecedor=Boolean(fornecedorInformado && fornecedorDetectado &&
      fornecedorInformado !== fornecedorDetectado);
    const conflitanteNumero=Boolean(numeroInformado && numeroDetectado &&
      numeroInformado !== numeroDetectado);
    if(conflitanteFornecedor) resultado.avisos.push('Fornecedor selecionado é diferente do reconhecido no arquivo. Selecione o correto para evitar vincular à NF errada.');
    if(conflitanteNumero) resultado.avisos.push('Número da NF digitado difere do reconhecido no arquivo. Confira antes de gravar.');
    const fornecedor_id=fornecedorInformado || fornecedorDetectado;
    const numero_nf=numeroInformado || numeroDetectado;
    dados.fornecedor_id=fornecedor_id || null;
    dados.numero_nf=numero_nf;
    if (!fornecedor_id || !numero_nf) {
      resultado.avisos.push('Informe fornecedor e número da NF para completar o cadastro.');
    } else if (!conflitanteFornecedor && !conflitanteNumero) {
      try {
        resultado.registro=await service.importarDaIa(dados);
      } catch(e) {
        if((e.status || 500) >= 500) throw e;
        resultado.avisos.push('Importação automática não concluída: '+e.message+' Corrija os campos e salve manualmente.');
      }
    }
    res.json(resultado);
  } catch(e){tratar(res,e);}
});
router.get('/localizar',async(req,res)=>{
  try{res.json({nota:await service.localizar(req.query.fornecedor_id,req.query.numero_nf)});}
  catch(e){tratar(res,e);}
});
router.get('/',async(req,res)=>{try{res.json(await service.listar(req.query));}catch(e){tratar(res,e);}});
router.get('/:id',async(req,res)=>{try{res.json(await service.buscar(req.params.id));}catch(e){tratar(res,e);}});
router.post('/',async(req,res)=>{try{res.status(201).json(await service.gravar(req.body));}catch(e){tratar(res,e);}});
router.put('/:id',async(req,res)=>{try{res.json(await service.gravar(req.body,req.params.id));}catch(e){tratar(res,e);}});
module.exports = router;
