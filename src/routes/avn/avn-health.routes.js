'use strict';
const express = require('express');
const pool = require('../../../db/connection');
const router = express.Router();
const supported = new Set(['peso','gordura_corporal','massa_magra','agua_corporal','massa_ossea','tmb','passos','calorias_ativas','calorias_totais']);
const allowedOrigins = new Set(['health_connect','manual']);
const isId = x => /^\d+$/.test(String(x||''));
const date = x => typeof x === 'string' && x.length <= 40 && !Number.isNaN(Date.parse(x)) ? new Date(x) : null;
async function userExists(id){const q=await pool.query('SELECT 1 FROM public.avn_usuario WHERE id=$1',[id]);return q.rowCount>0;}
function bad(msg){return Object.assign(new Error(msg),{status:400});}
function err(res,e){console.error('[AVN Health]',e);res.status(e.status||500).json({erro:e.status?e.message:'Não foi possível completar a operação.'});}
router.get('/metricas',async(_req,res)=>{try{const r=await pool.query('SELECT id,codigo,nome,categoria,unidade,origem_padrao FROM public.avn_metricas WHERE ativo ORDER BY id');res.json(r.rows);}catch(e){err(res,e);}});
router.get('/usuarios/:usuarioId/historico',async(req,res)=>{
 try{
  const {usuarioId}=req.params, codigo=String(req.query.metrica||'');
  if(!isId(usuarioId)||!codigo)throw bad('Usuário e métrica são obrigatórios.');
  const dias=Math.max(1,Math.min(3650,Number(req.query.dias)||90));
  const m=await pool.query('SELECT id FROM public.avn_metricas WHERE codigo=$1',[codigo]);
  if(!m.rowCount)return res.status(404).json({erro:'Métrica não encontrada.'});
  if(!await userExists(usuarioId))return res.status(404).json({erro:'Usuário não encontrado.'});
  const result=await pool.query(`SELECT data_medicao,data_fim,valor,origem,aplicativo_origem,qualidade FROM public.avn_medicoes WHERE usuario_id=$1 AND metrica_id=$2 AND data_medicao>=NOW()-($3::int*INTERVAL '1 day') ORDER BY data_medicao,id LIMIT 15000`,[usuarioId,m.rows[0].id,dias]);
  res.set('Cache-Control','no-store');res.json({metrica:codigo,dias,registros:result.rows});
 }catch(e){err(res,e);}
});
router.get('/usuarios/:usuarioId/atividades',async(req,res)=>{
 try{if(!isId(req.params.usuarioId))throw bad('Usuário inválido.');const dias=Math.max(1,Math.min(3650,Number(req.query.dias)||90));
 const r=await pool.query(`SELECT inicio,fim,tipo_atividade,titulo,calorias_kcal,origem FROM public.avn_atividades WHERE usuario_id=$1 AND inicio>=NOW()-($2::int*INTERVAL '1 day') ORDER BY inicio DESC LIMIT 2000`,[req.params.usuarioId,dias]);res.json(r.rows);
 }catch(e){err(res,e);}
});
// Ingestão administrativa para validação. Android precisará de credencial própria em etapa posterior.
async function importar(req,res){
 let client;
 try{
  const usuarioId=req.params.usuarioId;
  if(!isId(usuarioId))throw bad('Usuário inválido.');
  const medicoes=req.body?.medicoes??[], atividades=req.body?.atividades??[];
  if(!Array.isArray(medicoes)||!Array.isArray(atividades)||medicoes.length+atividades.length===0||medicoes.length+atividades.length>500)throw bad('Envie entre 1 e 500 registros por lote.');
  const metrics=await pool.query('SELECT id,codigo FROM public.avn_metricas');
  const map=new Map(metrics.rows.map(x=>[x.codigo,x.id]));
  const clean=[];
  for(const m of medicoes){
   if(!supported.has(m.metrica)||!map.has(m.metrica))throw bad('Métrica não suportada.');
   const valor=Number(m.valor),ini=date(m.data_medicao),fim=m.data_fim==null?null:date(m.data_fim);
   if(!Number.isFinite(valor)||Math.abs(valor)>100000000||!ini||(fim&&fim<ini)||(m.data_fim!=null&&!fim))throw bad('Medição inválida.');
   if(!allowedOrigins.has(m.origem)||!['medido','estimado'].includes(m.qualidade||'medido'))throw bad('Origem ou qualidade inválida.');
   if(m.origem==='health_connect'&&(!m.registro_externo_id||!m.aplicativo_origem))throw bad('Health Connect exige ID do registro e aplicativo de origem.');
   if(m.registro_externo_id&&String(m.registro_externo_id).length>240)throw bad('ID externo longo demais.');
   clean.push({id:map.get(m.metrica),valor,ini,fim,origem:m.origem,app:String(m.aplicativo_origem||'').slice(0,160)||null,ext:m.registro_externo_id||null,unidade:String(m.unidade_original||'').slice(0,40)||null,meta:JSON.stringify(m.metadados&&typeof m.metadados==='object'&&!Array.isArray(m.metadados)?m.metadados:{}),qualidade:m.qualidade||'medido'});
  }
  const sessions=[];
  for(const a of atividades){const ini=date(a.inicio),fim=date(a.fim);if(!ini||!fim||fim<ini||a.origem!=='health_connect'||!a.registro_externo_id||!a.aplicativo_origem)throw bad('Sessão inválida.');
   const kcal=a.calorias_kcal==null?null:Number(a.calorias_kcal);if(kcal!==null&&(!Number.isFinite(kcal)||kcal<0||kcal>10000000))throw bad('Calorias inválidas.');
   sessions.push({ini,fim,kind:String(a.tipo_atividade||'').slice(0,120)||null,title:String(a.titulo||'').slice(0,200)||null,app:String(a.aplicativo_origem).slice(0,160),ext:String(a.registro_externo_id).slice(0,240),kcal,meta:JSON.stringify(a.metadados&&typeof a.metadados==='object'&&!Array.isArray(a.metadados)?a.metadados:{})});
  }
  client=await pool.connect();await client.query('BEGIN');
  if(!(await client.query('SELECT id FROM public.avn_usuario WHERE id=$1 FOR KEY SHARE',[usuarioId])).rowCount)throw Object.assign(new Error('Usuário não encontrado.'),{status:404});
  const sync=await client.query(`INSERT INTO public.avn_sincronizacoes(usuario_id,fonte,dispositivo_id,registros_recebidos) VALUES($1,'health_connect',$2,$3) RETURNING id`,[usuarioId,String(req.body?.dispositivo_id||'').slice(0,160)||null,clean.length+sessions.length]);
  let inserted=0,updated=0;
  for(const m of clean){
   if(!m.ext){await client.query(`INSERT INTO public.avn_medicoes(usuario_id,metrica_id,valor,data_medicao,data_fim,origem,aplicativo_origem,unidade_original,qualidade,metadados) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`,[usuarioId,m.id,m.valor,m.ini,m.fim,m.origem,m.app,m.unidade,m.qualidade,m.meta]);inserted++;continue;}
   const r=await client.query(`INSERT INTO public.avn_medicoes(usuario_id,metrica_id,valor,data_medicao,data_fim,origem,aplicativo_origem,registro_externo_id,unidade_original,qualidade,metadados) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb) ON CONFLICT (usuario_id,metrica_id,origem,aplicativo_origem,registro_externo_id) WHERE registro_externo_id IS NOT NULL DO UPDATE SET valor=EXCLUDED.valor,data_medicao=EXCLUDED.data_medicao,data_fim=EXCLUDED.data_fim,unidade_original=EXCLUDED.unidade_original,qualidade=EXCLUDED.qualidade,metadados=EXCLUDED.metadados,atualizado_em=NOW() RETURNING (xmax=0) AS inserted`,[usuarioId,m.id,m.valor,m.ini,m.fim,m.origem,m.app,m.ext,m.unidade,m.qualidade,m.meta]);
   if(r.rows[0]?.inserted)inserted++;else updated++;
  }
  for(const a of sessions){const r=await client.query(`INSERT INTO public.avn_atividades(usuario_id,inicio,fim,tipo_atividade,titulo,origem,aplicativo_origem,registro_externo_id,calorias_kcal,metadados) VALUES($1,$2,$3,$4,$5,'health_connect',$6,$7,$8,$9::jsonb) ON CONFLICT (usuario_id,origem,aplicativo_origem,registro_externo_id) WHERE registro_externo_id IS NOT NULL DO UPDATE SET inicio=EXCLUDED.inicio,fim=EXCLUDED.fim,tipo_atividade=EXCLUDED.tipo_atividade,titulo=EXCLUDED.titulo,calorias_kcal=EXCLUDED.calorias_kcal,metadados=EXCLUDED.metadados,atualizado_em=NOW() RETURNING (xmax=0) AS inserted`,[usuarioId,a.ini,a.fim,a.kind,a.title,a.app,a.ext,a.kcal,a.meta]);if(r.rows[0]?.inserted)inserted++;else updated++;}
  await client.query(`UPDATE public.avn_sincronizacoes SET status='concluida',finalizada_em=NOW(),registros_inseridos=$2,registros_atualizados=$3 WHERE id=$1`,[sync.rows[0].id,inserted,updated]);
  await client.query('COMMIT');res.json({ok:true,recebidos:clean.length+sessions.length,inseridos:inserted,atualizados:updated,sincronizacao_id:sync.rows[0].id});
 }catch(e){if(client)await client.query('ROLLBACK').catch(()=>{});err(res,e);}finally{if(client)client.release();}
}
router.post('/usuarios/:usuarioId/importar', importar);
module.exports=router;
module.exports.importar=importar;
