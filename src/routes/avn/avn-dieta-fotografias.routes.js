'use strict';
// Fotografias completas e restauração transacional, isoladas por usuário.
const express=require('express');
const pool=require('../../../db/connection');
const router=express.Router({mergeParams:true});
const REFEICOES=new Set(['cafe','lanche_manha','almoco','lanche_tarde','jantar','ceia','outros']);
const erro=(msg,status=400)=>Object.assign(new Error(msg),{status});
const id=v=>{if(!/^\d+$/.test(String(v??''))||Number(v)<=0)throw erro('Identificador inválido.');return String(v);};
const wrap=fn=>(req,res,next)=>Promise.resolve().then(()=>fn(req,res)).catch(next);
const nome=v=>{const s=String(v||'').trim();if(!s||s.length>100)throw erro('Informe um nome de até 100 caracteres.');return s;};
async function planoAtual(db,uid,lock=false){
 const r=await db.query('SELECT id FROM public.avn_dieta_planos WHERE usuario_id=$1 AND ativo ORDER BY id DESC LIMIT 1'+(lock?' FOR UPDATE':''),[uid]);
 return r.rows[0]?.id||null;
}
function iguais(a,b){
 if(a.length!==b.length)return false;
 return a.every((i,n)=>String(i.alimento_id)===String(b[n].alimento_id)&&
  Number(i.quantidade_g)===Number(b[n].quantidade_g)&&Number(i.ordem)===Number(b[n].ordem)&&
  JSON.stringify(i.composicao_100g||{})===JSON.stringify(b[n].composicao_100g||{}));
}
router.get('/',wrap(async(req,res)=>{
 const uid=id(req.params.usuarioId);
 const r=await pool.query(`SELECT id,nome,criado_em,
 jsonb_array_length(dados->'refeicoes') AS refeicoes,
 (SELECT COALESCE(SUM(jsonb_array_length(x->'itens')),0)::int
  FROM jsonb_array_elements(dados->'refeicoes') x) AS alimentos
 FROM public.avn_dieta_fotografias WHERE usuario_id=$1 ORDER BY criado_em DESC,id DESC`,[uid]);
 res.set('Cache-Control','no-store').json({fotografias:r.rows});
}));
router.post('/',wrap(async(req,res)=>{
 const uid=id(req.params.usuarioId),titulo=nome(req.body?.nome),db=await pool.connect();
 try{
  await db.query('BEGIN');
  const pid=await planoAtual(db,uid,true);
  if(!pid)throw erro('Não há dieta programada para fotografar.');
  const pf=await db.query('SELECT id,refeicao,nome,recuperado FROM public.avn_dieta_refeicao_perfis WHERE plano_id=$1 AND ativo ORDER BY refeicao,id',[pid]);
  const it=await db.query(`SELECT i.perfil_id,i.refeicao,i.alimento_id,i.quantidade_g,i.ordem,
   COALESCE(i.composicao_100g,jsonb_build_object(
    'kcal',a.kcal_100g,'proteinas_g',a.proteinas_g_100g,
    'carboidratos_g',a.carboidratos_g_100g,'gorduras_g',a.gorduras_g_100g,
    'fibras_g',a.fibras_g_100g,'micros',a.micronutrientes_100g)) AS composicao_100g
   FROM public.avn_dieta_itens i JOIN public.avn_dieta_refeicao_perfis p ON p.id=i.perfil_id AND p.ativo
   JOIN public.avn_alimentos a ON a.id=i.alimento_id
   WHERE i.plano_id=$1 ORDER BY i.refeicao,i.ordem,i.id`,[pid]);
  if(it.rowCount>500)throw erro('Limite de 500 alimentos por fotografia.');
  const dados={versao:1,refeicoes:pf.rows.map(p=>({
   refeicao:p.refeicao,perfil_id:p.recuperado?null:p.id,perfil_nome:p.recuperado?null:p.nome,
   itens:it.rows.filter(i=>String(i.perfil_id)===String(p.id)).map(i=>({
    alimento_id:i.alimento_id,quantidade_g:i.quantidade_g,ordem:i.ordem,
    composicao_100g:i.composicao_100g
   }))
  }))};
  const r=await db.query('INSERT INTO public.avn_dieta_fotografias(usuario_id,nome,dados) VALUES($1,$2,$3::jsonb) RETURNING id,nome,criado_em',[uid,titulo,JSON.stringify(dados)]);
  await db.query('COMMIT');
  res.status(201).json({ok:true,fotografia:r.rows[0]});
 }catch(e){await db.query('ROLLBACK').catch(()=>{});throw e;}finally{db.release();}
}));
router.delete('/:fotografiaId',wrap(async(req,res)=>{
 const r=await pool.query('DELETE FROM public.avn_dieta_fotografias WHERE id=$1 AND usuario_id=$2 RETURNING id',[id(req.params.fotografiaId),id(req.params.usuarioId)]);
 if(!r.rowCount)throw erro('Fotografia não encontrada.',404);
 res.json({ok:true});
}));
router.post('/perfil-recuperado/:perfilId/salvar',wrap(async(req,res)=>{
 const uid=id(req.params.usuarioId),perfilId=id(req.params.perfilId),titulo=nome(req.body?.nome);
 if(titulo.length>80)throw erro('O nome do perfil deve ter até 80 caracteres.');
 const db=await pool.connect();
 try{
  await db.query('BEGIN');
  const pid=await planoAtual(db,uid,true);
  if(!pid)throw erro('Dieta não encontrada.',404);
  const r=await db.query(`UPDATE public.avn_dieta_refeicao_perfis
   SET nome=$3,recuperado=FALSE WHERE id=$2 AND plano_id=$1 AND recuperado AND ativo
   RETURNING id,nome,refeicao`,[pid,perfilId,titulo]);
  if(!r.rowCount)throw erro('Refeição recuperada não encontrada.',404);
  await db.query('COMMIT');
  res.json({ok:true,perfil:r.rows[0]});
 }catch(e){await db.query('ROLLBACK').catch(()=>{});throw e;}finally{db.release();}
}));
router.post('/:fotografiaId/restaurar',wrap(async(req,res)=>{
 const uid=id(req.params.usuarioId),sid=id(req.params.fotografiaId),db=await pool.connect();
 try{
  await db.query('BEGIN');
  const foto=await db.query('SELECT dados FROM public.avn_dieta_fotografias WHERE id=$1 AND usuario_id=$2',[sid,uid]);
  if(!foto.rowCount)throw erro('Fotografia não encontrada.',404);
  const dados=foto.rows[0].dados;
  if(dados?.versao!==1||!Array.isArray(dados.refeicoes))throw erro('Formato da fotografia inválido.');
  const usados=new Set(),ids=[];
  for(const r of dados.refeicoes){
   if(!REFEICOES.has(r.refeicao)||usados.has(r.refeicao)||!Array.isArray(r.itens))throw erro('Refeições inválidas na fotografia.');
   usados.add(r.refeicao);
   for(const i of r.itens){
    id(i.alimento_id);
    if(!Number.isFinite(Number(i.quantidade_g))||Number(i.quantidade_g)<=0||Number(i.quantidade_g)>10000||
      !Number.isInteger(Number(i.ordem))||Number(i.ordem)<0)throw erro('Alimento inválido na fotografia.');
    ids.push(String(i.alimento_id));
   }
  }
  if(ids.length>500)throw erro('Fotografia acima do limite de alimentos.');
  const uniq=[...new Set(ids)];
  if(uniq.length){
   const r=await db.query(`SELECT id FROM public.avn_alimentos
    WHERE id=ANY($1::bigint[]) AND ativo AND (usuario_id IS NULL OR usuario_id=$2)`,[uniq,uid]);
   const valid=new Set(r.rows.map(x=>String(x.id)));
   if(uniq.some(x=>!valid.has(x)))throw erro('Há alimentos da fotografia excluídos ou indisponíveis. A dieta atual foi preservada.',409);
  }
  let pid=await planoAtual(db,uid,true);
  if(!pid){
   const p=await db.query("INSERT INTO public.avn_dieta_planos(usuario_id,nome,ativo) VALUES($1,'Dieta padrão',TRUE) RETURNING id",[uid]);
   pid=p.rows[0].id;
  }
  const perfiles=await db.query('SELECT id,refeicao,nome,recuperado FROM public.avn_dieta_refeicao_perfis WHERE plano_id=$1 ORDER BY id',[pid]);
  const atuais=await db.query(`SELECT i.perfil_id,i.alimento_id,i.quantidade_g,i.ordem,
   COALESCE(i.composicao_100g,jsonb_build_object(
    'kcal',a.kcal_100g,'proteinas_g',a.proteinas_g_100g,
    'carboidratos_g',a.carboidratos_g_100g,'gorduras_g',a.gorduras_g_100g,
    'fibras_g',a.fibras_g_100g,'micros',a.micronutrientes_100g)) AS composicao_100g
   FROM public.avn_dieta_itens i JOIN public.avn_alimentos a ON a.id=i.alimento_id
   WHERE i.plano_id=$1 ORDER BY i.perfil_id,i.ordem,i.id`,[pid]);
  const matches=dados.refeicoes.map(r=>{
   const p=perfiles.rows.find(p=>!p.recuperado&&String(p.id)===String(r.perfil_id)&&p.refeicao===r.refeicao);
   const itens=p?atuais.rows.filter(i=>String(i.perfil_id)===String(p.id)):[];
   return p&&iguais(itens,r.itens)?p.id:null;
  });
  await db.query('UPDATE public.avn_dieta_refeicao_perfis SET ativo=FALSE WHERE plano_id=$1 AND ativo',[pid]);
  // Somente os perfis transitórios podem ser removidos. Os cadastrados permanecem intactos.
  await db.query('DELETE FROM public.avn_dieta_refeicao_perfis WHERE plano_id=$1 AND recuperado',[pid]);
  const dia=await db.query('SELECT COALESCE(MIN(dia_semana),0) AS dia FROM public.avn_dieta_itens WHERE plano_id=$1',[pid]);
  let recuperados=0;
  for(let n=0;n<dados.refeicoes.length;n++){
   const r=dados.refeicoes[n];
   if(matches[n]){
    await db.query('UPDATE public.avn_dieta_refeicao_perfis SET ativo=TRUE WHERE id=$1 AND plano_id=$2',[matches[n],pid]);
    continue;
   }
   const temp=await db.query(`INSERT INTO public.avn_dieta_refeicao_perfis(plano_id,refeicao,nome,ativo,recuperado)
    VALUES($1,$2,'__foto_'||substr(md5(random()::text),1,16),TRUE,TRUE) RETURNING id`,[pid,r.refeicao]);
   recuperados++;
   for(const i of r.itens){
    await db.query(`INSERT INTO public.avn_dieta_itens
     (plano_id,dia_semana,refeicao,alimento_id,quantidade_g,ordem,perfil_id,composicao_100g)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
     [pid,dia.rows[0].dia,r.refeicao,i.alimento_id,i.quantidade_g,i.ordem,temp.rows[0].id,JSON.stringify(i.composicao_100g||{})]);
   }
  }
  await db.query('COMMIT');
  res.json({ok:true,refeicoes:dados.refeicoes.length,perfis_sem_cadastro:recuperados});
 }catch(e){await db.query('ROLLBACK').catch(()=>{});throw e;}finally{db.release();}
}));
module.exports=router;
