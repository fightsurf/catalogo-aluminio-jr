'use strict';
const express = require('express');
const crypto = require('node:crypto');
const pool = require('../../../db/connection');
const V = require('../../services/avn/avn-treinos-validacao');
const router=express.Router();
const catalogo = require('../../services/avn/avn-treinos-catalogo.service');
const grupos=async()=> (await pool.query('SELECT id,slug,nome,ordem FROM public.avn_exercicio_grupos ORDER BY ordem,nome')).rows;
const listaSQL=`SELECT e.id,e.slug,e.nome,e.grupo_id,g.nome AS grupo,e.equipamento,e.instrucoes,e.midia_url,e.midia_tipo,e.ativo
  FROM public.avn_exercicios e JOIN public.avn_exercicio_grupos g ON g.id=e.grupo_id`;
const handle=(res,e)=>{console.error('[AVN treinos]',e);return res.status(e.status|| (e.code==='23503'?409:e.code==='23505'?409:500)).json({erro:e.status?e.message:e.code==='23503'?'Registro vinculado a outros dados.':e.code==='23505'?'Registro duplicado.':'Falha ao processar. Confira a migração AVN.'});};
const route=(fn)=>async(req,res)=>{try{await fn(req,res);}catch(e){handle(res,e);}};
router.post('/catalogo/sincronizar',route(async(_req,res)=>res.json(await catalogo.importarCatalogo())));
router.get('/grupos',route(async(_req,res)=>res.json(await grupos())));
router.get('/exercicios',route(async(req,res)=>{
  const busca=V.texto(req.query.busca,120),grupo=String(req.query.grupo||'');
  const params=[busca,grupo];
  const r=await pool.query(`${listaSQL}
    WHERE e.ativo=TRUE AND ($1='' OR translate(lower(e.nome),'áàâãäéèêëíìîïóòôõöúùûüç','aaaaaeeeeiiiiooooouuuuc') LIKE '%'||translate(lower($1),'áàâãäéèêëíìîïóòôõöúùûüç','aaaaaeeeeiiiiooooouuuuc')||'%')
    AND ($2='' OR g.slug=$2) ORDER BY g.ordem,e.nome LIMIT 500`,params);
  res.set('Cache-Control','no-store').json(r.rows.map(row=>({...row,midia_url:catalogo.normalizarMidia(row.midia_url)})));
}));
router.post('/exercicios',route(async(req,res)=>{
  const v=V.exercicio(req.body||{});
  // Criado manualmente: slug reservado evita colisão com o catálogo inicial.
  const r=await pool.query(`INSERT INTO public.avn_exercicios(slug,nome,grupo_id,equipamento,instrucoes,midia_url,midia_tipo)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,['custom-'+crypto.randomUUID(),v.nome,v.grupo_id,v.equipamento,v.instrucoes,v.midia_url,v.midia_tipo]);
  res.status(201).json({ok:true,id:r.rows[0].id});
}));
router.put('/exercicios/:id',route(async(req,res)=>{
  if(!V.id(req.params.id))throw V.erro('Exercício inválido.');const v=V.exercicio(req.body||{});
  const r=await pool.query(`UPDATE public.avn_exercicios SET nome=$2,grupo_id=$3,equipamento=$4,instrucoes=$5,midia_url=$6,midia_tipo=$7,atualizado_em=NOW() WHERE id=$1 RETURNING id`,[req.params.id,v.nome,v.grupo_id,v.equipamento,v.instrucoes,v.midia_url,v.midia_tipo]);
  if(!r.rowCount)throw V.erro('Exercício não encontrado.',404);res.json({ok:true,id:r.rows[0].id});
}));
router.delete('/exercicios/:id',route(async(req,res)=>{
  if(!V.id(req.params.id))throw V.erro('Exercício inválido.');
  const r=await pool.query('UPDATE public.avn_exercicios SET ativo=FALSE,atualizado_em=NOW() WHERE id=$1 RETURNING id',[req.params.id]);
  if(!r.rowCount)throw V.erro('Exercício não encontrado.',404);res.json({ok:true});
}));
router.get('/planos',route(async(req,res)=>{
  if(!V.id(req.query.usuario_id))throw V.erro('Selecione um usuário.');
  const r=await pool.query(`SELECT id,usuario_id,nome,descricao,criado_em,atualizado_em FROM public.avn_planos_treino WHERE usuario_id=$1 AND ativo=TRUE ORDER BY atualizado_em DESC LIMIT 100`,[req.query.usuario_id]);
  res.json(r.rows);
}));
async function consultarPlano(id,client=pool){
  const r=await client.query('SELECT id,usuario_id,nome,descricao,criado_em,atualizado_em FROM public.avn_planos_treino WHERE id=$1 AND ativo=TRUE',[id]);
  if(!r.rowCount)throw V.erro('Plano não encontrado.',404);
  const d=await client.query(`SELECT d.id,d.dia_semana,i.exercicio_id,i.posicao,i.series,i.repeticoes,i.carga_kg,i.descanso_seg,i.observacoes,e.nome AS exercicio_nome,e.midia_url,e.midia_tipo
    FROM public.avn_plano_dias d LEFT JOIN public.avn_plano_itens i ON i.plano_dia_id=d.id
    LEFT JOIN public.avn_exercicios e ON e.id=i.exercicio_id WHERE d.plano_id=$1 ORDER BY d.dia_semana,i.posicao`,[id]);
  const days=new Map();for(const row of d.rows){if(!days.has(row.dia_semana))days.set(row.dia_semana,{dia_semana:row.dia_semana,exercicios:[]});if(row.exercicio_id!==null)days.get(row.dia_semana).exercicios.push({...row,midia_url:catalogo.normalizarMidia(row.midia_url)});}
  return {...r.rows[0],dias:[...days.values()]};
}
router.get('/planos/:id',route(async(req,res)=>{if(!V.id(req.params.id))throw V.erro('Plano inválido.');res.json(await consultarPlano(req.params.id));}));
async function salvarPlano(req,res,atualizar=false){
  const v=V.plano(req.body||{});
  if(atualizar&&!V.id(req.params.id))throw V.erro('Plano inválido.');
  const client=await pool.connect();let committed=false;
  try{
    await client.query('BEGIN');
    const u=await client.query('SELECT 1 FROM public.avn_usuario WHERE id=$1 FOR KEY SHARE',[v.usuario_id]);
    if(!u.rowCount)throw V.erro('Usuário inexistente.',404);
    const ids=[...new Set(v.dias.flatMap(d=>d.itens.map(i=>i.exercicio_id)))];
    if(ids.length){const e=await client.query('SELECT id FROM public.avn_exercicios WHERE id = ANY($1::bigint[]) AND ativo=TRUE',[ids]);if(e.rowCount!==ids.length)throw V.erro('Há exercícios inexistentes ou desativados.');}
    let planoId;
    if(atualizar){
      const r=await client.query('UPDATE public.avn_planos_treino SET nome=$2,descricao=$3,atualizado_em=NOW() WHERE id=$1 AND usuario_id=$4 AND ativo=TRUE RETURNING id',[req.params.id,v.nome,v.descricao,v.usuario_id]);
      if(!r.rowCount)throw V.erro('Plano não encontrado para este usuário.',404);
      planoId=r.rows[0].id;
      await client.query('DELETE FROM public.avn_plano_dias WHERE plano_id=$1',[planoId]);
    }else{
      const r=await client.query('INSERT INTO public.avn_planos_treino(usuario_id,nome,descricao) VALUES($1,$2,$3) RETURNING id',[v.usuario_id,v.nome,v.descricao]);planoId=r.rows[0].id;
    }
    for(const d of v.dias){
      const created=await client.query('INSERT INTO public.avn_plano_dias(plano_id,dia_semana) VALUES($1,$2) RETURNING id',[planoId,d.dia_semana]);
      const diaId=created.rows[0].id;
      for(const i of d.itens){await client.query(`INSERT INTO public.avn_plano_itens(plano_dia_id,exercicio_id,posicao,series,repeticoes,carga_kg,descanso_seg,observacoes)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,[diaId,i.exercicio_id,i.posicao,i.series,i.repeticoes,i.carga_kg,i.descanso_seg,i.observacoes]);}
    }
    await client.query('COMMIT');committed=true;res.status(atualizar?200:201).json({ok:true,id:planoId});
  }catch(e){if(!committed)await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}
}
router.post('/planos',route((req,res)=>salvarPlano(req,res,false)));
router.put('/planos/:id',route((req,res)=>salvarPlano(req,res,true)));
router.delete('/planos/:id',route(async(req,res)=>{
  if(!V.id(req.params.id))throw V.erro('Plano inválido.');
  const r=await pool.query('UPDATE public.avn_planos_treino SET ativo=FALSE,atualizado_em=NOW() WHERE id=$1 RETURNING id',[req.params.id]);
  if(!r.rowCount)throw V.erro('Plano não encontrado.',404);res.json({ok:true});
}));
router.get('/sessoes',route(async(req,res)=>{
  if(!V.id(req.query.usuario_id))throw V.erro('Selecione um usuário.');
  const r=await pool.query(`SELECT s.id,s.plano_id,p.nome AS plano_nome,s.dia_semana,s.realizado_em,s.observacoes,
    (SELECT COUNT(*)::int FROM public.avn_treino_sessao_itens i WHERE i.sessao_id=s.id) AS total_exercicios
    FROM public.avn_treino_sessoes s JOIN public.avn_planos_treino p ON p.id=s.plano_id
    WHERE s.usuario_id=$1 ORDER BY s.realizado_em DESC LIMIT 100`,[req.query.usuario_id]);res.json(r.rows);
}));
router.get('/sessoes/:id',route(async(req,res)=>{
  if(!V.id(req.params.id))throw V.erro('Sessão inválida.');
  const r=await pool.query(`SELECT s.id,s.usuario_id,s.plano_id,s.dia_semana,s.realizado_em,s.observacoes,p.nome AS plano_nome
    FROM public.avn_treino_sessoes s JOIN public.avn_planos_treino p ON p.id=s.plano_id WHERE s.id=$1`,[req.params.id]);
  if(!r.rowCount)throw V.erro('Sessão não encontrada.',404);
  const i=await pool.query(`SELECT e.nome,i.series_realizadas,i.repeticoes_realizadas,i.carga_kg,i.observacoes
    FROM public.avn_treino_sessao_itens i JOIN public.avn_exercicios e ON e.id=i.exercicio_id
    WHERE i.sessao_id=$1 ORDER BY i.posicao`,[req.params.id]);
  res.json({...r.rows[0],exercicios:i.rows});
}));
router.post('/sessoes',route(async(req,res)=>{
  const v=V.sessao(req.body||{});if(!v.realizados.length)throw V.erro('Informe ao menos um exercício realizado.');
  const client=await pool.connect();let committed=false;
  try{
    await client.query('BEGIN');
    const p=await client.query('SELECT usuario_id FROM public.avn_planos_treino WHERE id=$1 FOR KEY SHARE',[v.plano_id]);
    if(!p.rowCount||Number(p.rows[0].usuario_id)!==v.usuario_id)throw V.erro('Plano não pertence ao usuário.',403);
    const r=await client.query(`SELECT i.exercicio_id FROM public.avn_plano_itens i JOIN public.avn_plano_dias d ON d.id=i.plano_dia_id WHERE d.plano_id=$1 AND d.dia_semana=$2`,[v.plano_id,v.dia_semana]);
    const validos=new Set(r.rows.map(x=>String(x.exercicio_id)));
    if(v.realizados.some(x=>!validos.has(String(x.exercicio_id))))throw V.erro('Há exercícios que não pertencem a este dia do plano.');
    const sessao=await client.query('INSERT INTO public.avn_treino_sessoes(usuario_id,plano_id,dia_semana,observacoes) VALUES($1,$2,$3,$4) RETURNING id',[v.usuario_id,v.plano_id,v.dia_semana,v.observacoes]);
    const sessaoId=sessao.rows[0].id;
    for(const x of v.realizados)await client.query(`INSERT INTO public.avn_treino_sessao_itens(sessao_id,exercicio_id,posicao,series_realizadas,repeticoes_realizadas,carga_kg,observacoes)
      VALUES($1,$2,$3,$4,$5,$6,$7)`,[sessaoId,x.exercicio_id,x.posicao,x.series_realizadas,x.repeticoes_realizadas,x.carga_kg,x.observacoes]);
    await client.query('COMMIT');committed=true;res.status(201).json({ok:true,id:sessaoId});
  }catch(e){if(!committed)await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}
}));
module.exports=router;
