'use strict';
// Rotas de importacao em lote (mount protegido em /avn/sistema/api/nutricao).
const express=require('express');
const multer=require('multer');
const pool=require('../../../db/connection');
const lote=require('../../services/avn/avn-alimentos-lote.service');
const router=express.Router();
const bad=(message,status=400)=>Object.assign(new Error(message),{status});
const uid=v=>{if(!/^[1-9]\d*$/.test(String(v||'')))throw bad('Selecione um usuário válido.');return String(v);};
const macroKeys=['kcal','proteinas_g','carboidratos_g','gorduras_g','fibras_g'];
const fields=['nome','marca','preparo','kcal_100g','proteinas_g_100g','carboidratos_g_100g','gorduras_g_100g','fibras_g_100g','micronutrientes_100g'];
const queryExistentes=async(db,usuario)=>(
 await db.query("SELECT id,nome,preparo,marca FROM public.avn_alimentos WHERE ativo AND tipo='alimento' AND (usuario_id IS NULL OR usuario_id=$1)",[usuario])
).rows;
const wrap=fn=>async(req,res)=>{try{await fn(req,res);}catch(e){
 console.error('[AVN alimentos em lote]',e);
 res.set('Cache-Control','no-store').status(e.status||500).json({erro:e.status?e.message:'Erro interno na importação de alimentos.'});
}};
async function verificarUsuario(usuario,db=pool){
 const r=await db.query('SELECT 1 FROM public.avn_usuario WHERE id=$1',[usuario]);
 if(!r.rowCount)throw bad('Usuário AVN não encontrado.',404);
}
const upload=multer({
 storage:multer.memoryStorage(),
 limits:{fileSize:8*1024*1024,files:1,fields:1,parts:2},
 fileFilter:(_req,file,cb)=>{
  if(!['image/jpeg','image/png','image/webp'].includes(file.mimetype))
   return cb(bad('Use uma imagem JPG, PNG ou WebP.',415));
  cb(null,true);
 }
}).single('imagem');
router.post('/interpretar',(req,res,next)=>upload(req,res,err=>{
 if(err)return res.status(err.code==='LIMIT_FILE_SIZE'?413:err.status||400)
  .set('Cache-Control','no-store').json({erro:err.code==='LIMIT_FILE_SIZE'?'O print excede 8 MB.':err.message});
 if(!req.file)return res.status(400).set('Cache-Control','no-store').json({erro:'Selecione um print com os nomes dos alimentos.'});
 next();
}),wrap(async(req,res)=>{
 const usuario=uid(req.body?.usuarioId);
 await verificarUsuario(usuario);
 const [itens,existentes]=await Promise.all([lote.extrairLista(req.file.buffer),queryExistentes(pool,usuario)]);
 res.set('Cache-Control','no-store').json({itens:lote.comparar(itens,existentes),limite:lote.MAX_ITENS});
}));
router.post('/pesquisar',wrap(async(req,res)=>{
 const usuario=uid(req.body?.usuarioId);
 const alimento=lote.validarIdentidade(req.body?.alimento);
 await verificarUsuario(usuario);
 const existentes=await queryExistentes(pool,usuario);
 const [item]=lote.comparar([alimento],existentes);
 if(item.duplicado)return res.set('Cache-Control','no-store').json({duplicado:item.duplicado});
 const {rows}=await pool.query('SELECT codigo,nome,unidade,categoria FROM public.avn_nutrientes ORDER BY codigo');
 const pesquisa=await lote.pesquisar(alimento,rows);
 res.set('Cache-Control','no-store').json({alimento:pesquisa});
}));
function numero(value,max,label){
 if(value===null||value===undefined||value==='')return null;
 if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>max)
  throw bad('Valor inválido para '+label+'. Confira as unidades por 100 g.');
 return value;
}
function validarComposicao(item,codigos){
 const alimento=lote.validarIdentidade(item);
 if(!item.macros||typeof item.macros!=='object'||Array.isArray(item.macros))throw bad('Macronutrientes ausentes em '+alimento.nome+'.');
 const macros={};
 for(const campo of macroKeys)macros[campo]=numero(item.macros[campo],campo==='kcal'?1000:100,campo+' de '+alimento.nome);
 if(!macroKeys.some(k=>macros[k]!==null))throw bad('Alimento sem macronutrientes: '+alimento.nome+'.');
 if(!item.micros||typeof item.micros!=='object'||Array.isArray(item.micros))throw bad('Micronutrientes inválidos em '+alimento.nome+'.');
 const micros={};
 for(const [codigo,valor] of Object.entries(item.micros)){
  if(!codigos.has(codigo))throw bad('Nutriente desconhecido: '+codigo+'.');
  const n=numero(valor,1000000,codigo+' de '+alimento.nome);
  if(n!==null)micros[codigo]=n;
 }
 const source=item.fonte==='taco'&&/^https:\/\/brolesi\.github\.io\/taco\/foods\/[1-9]\d{0,2}\.json$/.test(item.fonte_referencia||'')?'taco':'ia_pesquisa';
 const ref=typeof item.fonte_referencia==='string'&&item.fonte_referencia.length<=240&&/^https:\/\/[^\s]+$/.test(item.fonte_referencia)?item.fonte_referencia:null;
 return {...alimento,macros,micros,fonte:source,fonte_referencia:ref};
}
router.post('/salvar',wrap(async(req,res)=>{
 const usuario=uid(req.body?.usuarioId);
 const itens=req.body?.itens;
 if(!Array.isArray(itens)||itens.length===0||itens.length>lote.MAX_ITENS)
  throw bad('Selecione de 1 a '+lote.MAX_ITENS+' alimentos para salvar.');
 await verificarUsuario(usuario);
 const {rows:nutrientes}=await pool.query('SELECT codigo FROM public.avn_nutrientes');
 const codigos=new Set(nutrientes.map(n=>n.codigo));
 const validados=itens.map(item=>validarComposicao(item,codigos));
 const db=await pool.connect();
 try{
  await db.query('BEGIN');
  // Serializa importacoes simultaneas para o mesmo usuario e repete a verificacao imediatamente antes de inserir.
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))',['avn_alimentos_lote',usuario]);
  const existentes=await queryExistentes(db,usuario);
  const mapa=new Map(existentes.map(x=>[lote.chave(x),x]));
  const cadastrados=[],ignorados=[];
  for(const item of validados){
   const k=lote.chave(item);
   const duplicado=mapa.get(k);
   if(duplicado){ignorados.push({nome:item.nome,motivo:'Já cadastrado',id:duplicado.id});continue;}
   const valores=[
    item.nome,item.marca||null,item.preparo||null,
    ...macroKeys.map(k=>item.macros[k]),JSON.stringify(item.micros)
   ];
   const insercao=await db.query(
    `INSERT INTO public.avn_alimentos
     (usuario_id,${fields.join(',')},fonte,fonte_referencia,tipo)
     VALUES ($1,${fields.map((_,i)=>'$'+(i+2)).join(',')},$11,$12,'alimento')
     RETURNING id,nome`,
    [usuario,...valores,item.fonte,item.fonte_referencia]
   );
   const salvo=insercao.rows[0];
   cadastrados.push(salvo);
   mapa.set(k,{id:salvo.id,nome:item.nome,preparo:item.preparo,marca:item.marca});
  }
  await db.query('COMMIT');
  res.set('Cache-Control','no-store').json({cadastrados,ignorados});
 }catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
}));
module.exports=router;
