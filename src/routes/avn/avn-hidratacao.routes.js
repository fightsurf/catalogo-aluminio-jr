'use strict';
const express=require('express'),crypto=require('node:crypto');
const pool=require('../../../db/connection');
const web=express.Router(),mobile=express.Router();
const bad=(m,status=400)=>Object.assign(new Error(m),{status});
const wrap=fn=>async(req,res)=>{try{await fn(req,res);}catch(e){console.error('[AVN água]',e);res.status(e.status||500).json({erro:e.status?e.message:'Falha ao registrar água.'});}};
const uuid=s=>typeof s==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
const amount=x=>{const n=Number(x);if(!Number.isInteger(n)||n<1||n>10000)throw bad('Quantidade deve ser de 1 a 10.000 ml.');return n;};
const instant=x=>{const t=Date.parse(x);if(typeof x!=='string'||!Number.isFinite(t)||t>Date.now()+86400000||t<Date.now()-3650*86400000)throw bad('Data ou horário inválido.');return new Date(t).toISOString();};
const days=x=>[7,30,90].includes(Number(x))?Number(x):90;
async function uid(x){if(!/^[1-9][0-9]*$/.test(String(x||'')))throw bad('Usuário inválido.');const r=await pool.query('SELECT 1 FROM public.avn_usuario WHERE id=$1',[x]);if(!r.rowCount)throw bad('Usuário não encontrado.',404);return x;}
async function list(u,d){
 const r=await pool.query(`SELECT id,quantidade_ml,ingerido_em FROM public.avn_agua_registros WHERE usuario_id=$1 AND removido_em IS NULL
 AND (ingerido_em AT TIME ZONE 'America/Sao_Paulo')::date >= (NOW() AT TIME ZONE 'America/Sao_Paulo')::date - ($2::int-1)
 ORDER BY ingerido_em DESC LIMIT 5000`,[u,days(d)]);return r.rows;
}
async function upsert(db,u,e){
 if(!uuid(e?.id))throw bad('ID do registro inválido.');
 const r=await db.query(`INSERT INTO public.avn_agua_registros(id,usuario_id,quantidade_ml,ingerido_em) VALUES($1,$2,$3,$4)
 ON CONFLICT(id) DO UPDATE SET quantidade_ml=EXCLUDED.quantidade_ml,ingerido_em=EXCLUDED.ingerido_em,atualizado_em=NOW()
 WHERE public.avn_agua_registros.usuario_id=EXCLUDED.usuario_id AND public.avn_agua_registros.removido_em IS NULL RETURNING id`,
 [e.id,u,amount(e.quantidade_ml),instant(e.ingerido_em)]);
 if(!r.rowCount)throw bad('Registro indisponível.',409);
}
async function del(db,u,id){
 if(!uuid(id))throw bad('ID inválido.');
 const r=await db.query('UPDATE public.avn_agua_registros SET removido_em=COALESCE(removido_em,NOW()),atualizado_em=NOW() WHERE id=$1 AND usuario_id=$2 RETURNING id',[id,u]);
 if(!r.rowCount)throw bad('Registro não encontrado.',404);
}
web.get('/',wrap(async(req,res)=>{res.set('Cache-Control','no-store').json({registros:await list(await uid(req.query.usuarioId),req.query.dias)});}));
web.post('/',wrap(async(req,res)=>{const u=await uid(req.body?.usuarioId),id=crypto.randomUUID();await upsert(pool,u,{id,quantidade_ml:req.body?.quantidade_ml,ingerido_em:req.body?.ingerido_em||new Date().toISOString()});res.status(201).json({ok:true,id});}));
web.put('/:id',wrap(async(req,res)=>{await upsert(pool,await uid(req.body?.usuarioId),{id:req.params.id,quantidade_ml:req.body?.quantidade_ml,ingerido_em:req.body?.ingerido_em});res.json({ok:true});}));
web.delete('/:id',wrap(async(req,res)=>{await del(pool,await uid(req.query.usuarioId),req.params.id);res.json({ok:true});}));
mobile.get('/',wrap(async(req,res)=>{res.set('Cache-Control','no-store').json({registros:await list(req.avnm.usuario_id,90)});}));
mobile.post('/sincronizar',wrap(async(req,res)=>{
 const events=req.body?.eventos;if(!Array.isArray(events)||!events.length||events.length>100)throw bad('Envie de 1 a 100 registros.');
 const c=await pool.connect();try{await c.query('BEGIN');
  for(const e of events){if(e?.tipo==='upsert')await upsert(c,req.avnm.usuario_id,e);
   else if(e?.tipo==='delete')await del(c,req.avnm.usuario_id,e.id);
   else throw bad('Operação inválida.');
  }
  await c.query('COMMIT');res.json({ok:true,processados:events.length});
 }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}
}));
module.exports={web,mobile};
