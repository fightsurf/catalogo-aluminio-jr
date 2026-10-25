'use strict';
const express=require('express');
const crypto=require('node:crypto');
const pool=require('../../../db/connection');
const C=require('../../services/avn/avn-treinos-equipamentos.service');
const router=express.Router();
const validId=x=>/^\d+$/.test(String(x??''))&&Number(x)>0;
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const run=fn=>async(req,res)=>{try{await fn(req,res);}catch(e){console.error('[AVN treino config]',e);res.status(e.status||500).json({erro:e.status?e.message:'Falha ao processar configuração do treino.'});}};
const user=x=>{if(!validId(x))throw fail('Selecione um usuário válido.');return String(x);};
const limited=(x,max)=>String(x??'').trim().slice(0,max);
async function validUser(id){const r=await pool.query('SELECT 1 FROM public.avn_usuario WHERE id=$1',[id]);if(!r.rowCount)throw fail('Usuário não encontrado.',404);}
router.get('/perfil',run(async(req,res)=>{
 const uid=user(req.query.usuario_id);await validUser(uid);
 const r=await pool.query('SELECT * FROM public.avn_treino_perfil WHERE usuario_id=$1',[uid]);
 res.set('Cache-Control','no-store').json(r.rows[0]||{usuario_id:uid,nivel:'nao_informado',anos_experiencia:null,regularidade:'nao_informada',dias_semana:null,duracao_min:null,objetivo:'nao_informado',limitacoes:'',preferencias:''});
}));
router.put('/perfil',run(async(req,res)=>{
 const b=req.body||{},uid=user(b.usuario_id);await validUser(uid);
 const enums={nivel:['nao_informado','iniciante','intermediario','avancado'],regularidade:['nao_informada','regular','retornando','irregular'],objetivo:['nao_informado','recomposicao','hipertrofia','forca','condicionamento']};
 const values={};for(const [k,allowed] of Object.entries(enums)){const v=String(b[k]||allowed[0]);if(!allowed.includes(v))throw fail('Valor inválido: '+k);values[k]=v;}
 function nullable(x,min,max){if(x===null||x===undefined||x==='')return null;const n=Number(x);if(!Number.isFinite(n)||n<min||n>max)throw fail('Valor numérico fora dos limites.');return n;}
 const anos=nullable(b.anos_experiencia,0,80),dias=nullable(b.dias_semana,1,7),duracao=nullable(b.duracao_min,15,240);
 if(dias!==null&&!Number.isInteger(dias)||duracao!==null&&!Number.isInteger(duracao))throw fail('Dias e duração devem ser inteiros.');
 const limitacoes=limited(b.limitacoes,1200),preferencias=limited(b.preferencias,1200);
 const r=await pool.query(`INSERT INTO public.avn_treino_perfil(usuario_id,nivel,anos_experiencia,regularidade,dias_semana,duracao_min,objetivo,limitacoes,preferencias)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(usuario_id) DO UPDATE SET
 nivel=EXCLUDED.nivel,anos_experiencia=EXCLUDED.anos_experiencia,regularidade=EXCLUDED.regularidade,dias_semana=EXCLUDED.dias_semana,duracao_min=EXCLUDED.duracao_min,
 objetivo=EXCLUDED.objetivo,limitacoes=EXCLUDED.limitacoes,preferencias=EXCLUDED.preferencias,atualizado_em=NOW() RETURNING *`,[uid,values.nivel,anos,values.regularidade,dias,duracao,values.objetivo,limitacoes,preferencias]);
 res.json({ok:true,perfil:r.rows[0]});
}));
router.get('/equipamentos',run(async(req,res)=>{
 const uid=user(req.query.usuario_id);await validUser(uid);
 const dados=await C.dadosCompatibilidade(uid);
 res.set('Cache-Control','no-store').json({equipamentos:dados.equipamentos,selecionados:dados.selecionados,quantidade_compativeis:dados.exercicios.filter(x=>x.compativel).length,quantidade_pendentes:dados.exercicios.filter(x=>x.modo==='pendente').length});
}));
router.post('/equipamentos',run(async(req,res)=>{
 const nome=limited(req.body?.nome,150),categoria=limited(req.body?.categoria,50)||'Outros';
 if(nome.length<3)throw fail('Informe o nome do equipamento com pelo menos 3 caracteres.');
 const r=await pool.query('INSERT INTO public.avn_equipamentos(slug,nome,categoria,padrao) VALUES($1,$2,$3,FALSE) RETURNING *',['personalizado-'+crypto.randomUUID(),nome,categoria]);
 res.status(201).json(r.rows[0]);
}));
router.put('/equipamentos/selecionados',run(async(req,res)=>{
 const uid=user(req.body?.usuario_id),input=req.body?.ids;
 if(!Array.isArray(input)||input.length>200||input.some(x=>!validId(x)))throw fail('Lista de equipamentos inválida.');
 const ids=[...new Set(input.map(Number))];await validUser(uid);
 const c=await pool.connect();try{await c.query('BEGIN');
  // Serialização de gravações concorrentes do inventário do mesmo usuário.
  await c.query('SELECT id FROM public.avn_usuario WHERE id=$1 FOR UPDATE',[uid]);
  const found=await c.query('SELECT id FROM public.avn_equipamentos WHERE ativo=TRUE AND id=ANY($1::bigint[])',[ids]);
  if(found.rowCount!==ids.length)throw fail('Equipamento inexistente ou desativado.');
  await c.query('DELETE FROM public.avn_usuario_equipamentos WHERE usuario_id=$1',[uid]);
  if(ids.length)await c.query('INSERT INTO public.avn_usuario_equipamentos(usuario_id,equipamento_id) SELECT $1,unnest($2::bigint[])',[uid,ids]);
  await c.query('COMMIT');res.json({ok:true,total:ids.length});
 }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}
}));
router.get('/requisitos',run(async(req,res)=>{
 const uid=user(req.query.usuario_id);await validUser(uid);
 const dados=await C.dadosCompatibilidade(uid);res.set('Cache-Control','no-store').json({exercicios:dados.exercicios,equipamentos:dados.equipamentos,selecionados:dados.selecionados});
}));
router.put('/requisitos/:id',run(async(req,res)=>{
 const eid=req.params.id,b=req.body||{};if(!validId(eid))throw fail('Exercício inválido.');
 if(!['livre','equipamentos','pendente'].includes(b.modo))throw fail('Classificação inválida.');
 if(!Array.isArray(b.ids)||b.ids.length>20||b.ids.some(x=>!validId(x)))throw fail('Seleção de requisitos inválida.');
 const ids=[...new Set(b.ids.map(Number))];if(b.modo==='equipamentos'&&!ids.length)throw fail('Selecione ao menos um equipamento para este exercício.');
 if(b.modo!=='equipamentos'&&ids.length)throw fail('Exercícios sem equipamento não podem ter requisitos selecionados.');
 const client=await pool.connect();try{await client.query('BEGIN');
  const exercise=await client.query('SELECT 1 FROM public.avn_exercicios WHERE id=$1 AND ativo=TRUE',[eid]);if(!exercise.rowCount)throw fail('Exercício não encontrado.',404);
  const found=await client.query('SELECT id FROM public.avn_equipamentos WHERE ativo=TRUE AND id=ANY($1::bigint[])',[ids]);if(found.rowCount!==ids.length)throw fail('Há equipamento inexistente ou inativo.');
  await client.query(`INSERT INTO public.avn_exercicio_requisitos(exercicio_id,modo) VALUES($1,$2)
  ON CONFLICT(exercicio_id) DO UPDATE SET modo=EXCLUDED.modo,atualizado_em=NOW()`,[eid,b.modo]);
  await client.query('DELETE FROM public.avn_exercicio_equipamentos WHERE exercicio_id=$1',[eid]);
  if(ids.length)await client.query('INSERT INTO public.avn_exercicio_equipamentos(exercicio_id,equipamento_id) SELECT $1,unnest($2::bigint[])',[eid,ids]);
  await client.query('COMMIT');res.json({ok:true});
 }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}
}));
module.exports=router;
