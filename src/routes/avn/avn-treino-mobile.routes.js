'use strict';
const express=require('express');
const crypto=require('node:crypto');
const path=require('node:path');
const pool=require('../../../db/connection');
const V=require('../../services/avn/avn-treinos-validacao');
const catalogo=require('../../services/avn/avn-treinos-catalogo.service');
const admin=express.Router(), mobile=express.Router();
const digest=s=>crypto.createHash('sha256').update(s).digest('hex');
const err=(message,status=400)=>Object.assign(new Error(message),{status});
const wrap=fn=>async(req,res)=>{try{await fn(req,res);}catch(e){console.error('[AVN treino Android]',e.status||500,e.message);res.status(e.status||500).json({erro:e.status?e.message:'Falha interna nos treinos Android.'});}};
const validId=s=>V.id(s);
const uuid=s=>typeof s==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
const number=(v,min,max,label,optional=false)=>{if(optional&&(v===null||v===undefined))return null;if(!Number.isInteger(v)||v<min||v>max)throw err(label+' inválido.');return v;};
const instant=s=>{const n=typeof s==='string'?Date.parse(s):NaN;if(!Number.isFinite(n)||n>Date.now()+86400000||n<Date.now()-365*86400000)throw err('Horário fora do intervalo permitido.');return new Date(n).toISOString();};
admin.post('/pareamento',wrap(async(req,res)=>{
 const user=req.body?.usuario_id;if(!validId(user))throw err('Selecione um usuário.');
 const u=await pool.query('SELECT id FROM public.avn_usuario WHERE id=$1',[user]);if(!u.rowCount)throw err('Usuário não encontrado.',404);
 const code=crypto.randomBytes(9).toString('base64url').toUpperCase();
 await pool.query("INSERT INTO public.avn_treino_mobile_pareamentos(codigo_hash,usuario_id,expira_em) VALUES($1,$2,NOW()+INTERVAL '10 minutes')",[digest(code),user]);
 res.set('Cache-Control','no-store').json({codigo:code,expira_em:new Date(Date.now()+600000).toISOString()});
}));
admin.get('/dispositivos',wrap(async(req,res)=>{
 if(!validId(req.query.usuario_id))throw err('Usuário inválido.');
 const r=await pool.query('SELECT id,nome,criado_em,ultimo_acesso,revogado_em FROM public.avn_treino_mobile_dispositivos WHERE usuario_id=$1 ORDER BY criado_em DESC',[req.query.usuario_id]);res.json(r.rows);
}));
admin.delete('/dispositivos/:id',wrap(async(req,res)=>{
 if(!validId(req.params.id)||!validId(req.body?.usuario_id))throw err('Identificadores inválidos.');
 await pool.query('UPDATE public.avn_treino_mobile_dispositivos SET revogado_em=NOW() WHERE id=$1 AND usuario_id=$2',[req.params.id,req.body.usuario_id]);res.json({ok:true});
}));
admin.get('/execucoes',wrap(async(req,res)=>{
 if(!validId(req.query.usuario_id))throw err('Usuário inválido.');
 const r=await pool.query("SELECT x.id,x.plano_id,p.nome AS plano_nome,x.dia_semana,x.iniciada_em,x.finalizada_em,x.status,(SELECT COUNT(*)::int FROM public.avn_treino_execucao_eventos e WHERE e.execucao_id=x.id AND e.tipo='SERIE_CONCLUIDA') AS series_concluidas FROM public.avn_treino_execucoes x JOIN public.avn_planos_treino p ON p.id=x.plano_id WHERE x.usuario_id=$1 ORDER BY x.iniciada_em DESC LIMIT 100",[req.query.usuario_id]);res.json(r.rows);
}));
admin.get('/execucoes/:id',wrap(async(req,res)=>{
 if(!uuid(req.params.id))throw err('Execução inválida.');
 const r=await pool.query('SELECT x.*,p.nome AS plano_nome FROM public.avn_treino_execucoes x JOIN public.avn_planos_treino p ON p.id=x.plano_id WHERE x.id=$1',[req.params.id]);if(!r.rowCount)throw err('Execução não encontrada.',404);
 const events=await pool.query('SELECT * FROM public.avn_treino_execucao_eventos WHERE execucao_id=$1 ORDER BY ocorrido_em,id',[req.params.id]);res.json({...r.rows[0],eventos:events.rows});
}));
mobile.post('/parear',wrap(async(req,res)=>{
 const code=String(req.body?.codigo||'').trim().toUpperCase();
 if(!/^[A-Z0-9_-]{12}$/.test(code))throw err('Código inválido.',400);
 const c=await pool.connect();try{
  await c.query('BEGIN');
  const r=await c.query('UPDATE public.avn_treino_mobile_pareamentos SET consumido_em=NOW() WHERE codigo_hash=$1 AND consumido_em IS NULL AND expira_em>NOW() RETURNING usuario_id',[digest(code)]);
  if(!r.rowCount)throw err('Código expirado ou já utilizado.',401);
  const token=crypto.randomBytes(32).toString('base64url');
  const nome=String(req.body?.dispositivo||'Android AVN').trim().slice(0,120)||'Android AVN';
  await c.query('INSERT INTO public.avn_treino_mobile_dispositivos(usuario_id,token_hash,nome) VALUES($1,$2,$3)',[r.rows[0].usuario_id,digest(token),nome]);
  await c.query('COMMIT');res.set('Cache-Control','no-store').json({token,usuario_id:r.rows[0].usuario_id});
 }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}
}));
mobile.use(async(req,res,next)=>{try{
 const m=/^Bearer ([A-Za-z0-9_-]{40,100})$/.exec(req.get('Authorization')||'');if(!m)throw err('Dispositivo não autenticado.',401);
 const r=await pool.query('SELECT id,usuario_id FROM public.avn_treino_mobile_dispositivos WHERE token_hash=$1 AND revogado_em IS NULL',[digest(m[1])]);if(!r.rowCount)throw err('Acesso revogado.',401);
 req.avnm={id:r.rows[0].id,usuario_id:r.rows[0].usuario_id};next();
 }catch(e){res.status(e.status||500).json({erro:e.message});}});
mobile.get('/planos',wrap(async(req,res)=>{
 const r=await pool.query("SELECT p.id,p.nome,p.descricao,p.atualizado_em,(SELECT COUNT(*)::int FROM public.avn_plano_itens i JOIN public.avn_plano_dias d ON d.id=i.plano_dia_id WHERE d.plano_id=p.id) AS total_exercicios FROM public.avn_planos_treino p WHERE p.usuario_id=$1 AND p.ativo=TRUE ORDER BY p.atualizado_em DESC LIMIT 80",[req.avnm.usuario_id]);res.set('Cache-Control','no-store').json(r.rows);
}));
mobile.get('/planos/:id',wrap(async(req,res)=>{
 if(!validId(req.params.id))throw err('Plano inválido.');
 const p=await pool.query('SELECT id,nome,descricao,atualizado_em FROM public.avn_planos_treino WHERE id=$1 AND usuario_id=$2 AND ativo=TRUE',[req.params.id,req.avnm.usuario_id]);if(!p.rowCount)throw err('Plano não encontrado.',404);
 const r=await pool.query('SELECT d.dia_semana,i.exercicio_id,i.posicao,i.series,i.repeticoes,i.carga_kg,i.descanso_seg,i.observacoes,e.nome AS exercicio_nome,e.midia_url FROM public.avn_plano_dias d JOIN public.avn_plano_itens i ON i.plano_dia_id=d.id JOIN public.avn_exercicios e ON e.id=i.exercicio_id WHERE d.plano_id=$1 ORDER BY d.dia_semana,i.posicao',[req.params.id]);
 const dias=Array.from({length:7},(_,dia_semana)=>({dia_semana,exercicios:r.rows.filter(x=>Number(x.dia_semana)===dia_semana).map(x=>({...x,midia_url:catalogo.normalizarMidia(x.midia_url),imagem_url:'/api/avn/treinos-mobile/midias/'+x.exercicio_id}))}));
 res.set('Cache-Control','no-store').json({...p.rows[0],dias});
}));
mobile.get('/midias/:id',wrap(async(req,res)=>{
 if(!validId(req.params.id))throw err('Exercício inválido.');
 const r=await pool.query('SELECT midia_url FROM public.avn_exercicios WHERE id=$1',[req.params.id]);if(!r.rowCount)throw err('Imagem não encontrada.',404);
 const u=catalogo.normalizarMidia(r.rows[0].midia_url)||'';
 const x=/^\/avn\/sistema\/midias\/([a-z0-9-]+)\/frame-[123]\.(png|svg)$/.exec(u);
 if(!x)throw err('Imagem local indisponível.',404);
 const root=path.dirname(require.resolve('@bryllim/workout-guide/manifest.json'));
 res.set('Cache-Control','private,max-age=86400').sendFile(path.join(root,'assets',x[1],'frame-1.'+x[2]));
}));
mobile.post('/execucoes',wrap(async(req,res)=>{
 const b=req.body||{};
 if(!uuid(b.execucao_id)||!validId(b.plano_id))throw err('ID de execução/plano inválido.');
 const day=number(b.dia_semana,0,6,'Dia');
 if(!Array.isArray(b.snapshot_exercicios)||b.snapshot_exercicios.length>50||b.snapshot_exercicios.some(x=>!validId(x)))throw err('Exercícios inválidos.');
 const ids=b.snapshot_exercicios.map(Number);
 const u=await pool.query('SELECT id FROM public.avn_planos_treino WHERE id=$1 AND usuario_id=$2',[b.plano_id,req.avnm.usuario_id]);if(!u.rowCount)throw err('Plano não pertence ao usuário.',403);
 if(ids.length){const count=await pool.query('SELECT id FROM public.avn_exercicios WHERE id=ANY($1::bigint[])',[[...new Set(ids)]]);if(count.rowCount!==new Set(ids).size)throw err('Exercício inexistente.');}
 const at=instant(b.iniciada_em);
 const r=await pool.query("INSERT INTO public.avn_treino_execucoes(id,usuario_id,plano_id,dia_semana,iniciada_em,snapshot_exercicios) VALUES($1,$2,$3,$4,$5,$6::jsonb) ON CONFLICT(id) DO NOTHING",[b.execucao_id,req.avnm.usuario_id,b.plano_id,day,at,JSON.stringify(ids)]);
 const c=await pool.query('SELECT usuario_id,plano_id,dia_semana FROM public.avn_treino_execucoes WHERE id=$1',[b.execucao_id]);
 if(!c.rowCount||String(c.rows[0].usuario_id)!==String(req.avnm.usuario_id)||String(c.rows[0].plano_id)!==String(b.plano_id)||Number(c.rows[0].dia_semana)!==day)throw err('Execução duplicada com dados diferentes.',409);
 res.status(r.rowCount?201:200).json({ok:true,criada:!!r.rowCount});
}));
mobile.post('/execucoes/:id/eventos',wrap(async(req,res)=>{
 const id=req.params.id,items=req.body?.eventos;if(!uuid(id)||!Array.isArray(items)||items.length<1||items.length>50)throw err('Eventos inválidos.');
 const c=await pool.connect();try{
  await c.query('BEGIN');
  const session=await c.query('SELECT snapshot_exercicios,status FROM public.avn_treino_execucoes WHERE id=$1 AND usuario_id=$2 FOR UPDATE',[id,req.avnm.usuario_id]);
  if(!session.rowCount)throw err('Execução não encontrada.',404);
  const snapshot=session.rows[0].snapshot_exercicios||[];
  let inserted=0,dup=0;
  for(const e of items){
   if(!uuid(e?.id)||!['TREINO_INICIADO','SERIE_CONCLUIDA','DESCANSO_INICIADO','DESCANSO_FINALIZADO','EXERCICIO_PULADO','TREINO_FINALIZADO'].includes(e.tipo))throw err('Evento desconhecido.');
   const need=['SERIE_CONCLUIDA','DESCANSO_INICIADO','DESCANSO_FINALIZADO','EXERCICIO_PULADO'].includes(e.tipo);
   const pos=need?number(e.posicao_exercicio,1,50,'Posição'):null;
   const exercise=need?Number(e.exercicio_id):null;
   if(need&&(!validId(exercise)||Number(snapshot[pos-1])!==exercise))throw err('Exercício incompatível com a posição da execução.',409);
   const serie=e.tipo==='SERIE_CONCLUIDA'?number(e.numero_serie,1,30,'Série'):null;
   const kg=e.tipo==='SERIE_CONCLUIDA'&&e.carga_kg!=null?Number(e.carga_kg):null;
   if(kg!==null&&(!Number.isFinite(kg)||kg<0||kg>2000))throw err('Carga inválida.');
   const reps=e.tipo==='SERIE_CONCLUIDA'?number(e.repeticoes,0,1000,'Repetições'):null;
   const rir=e.tipo==='SERIE_CONCLUIDA'?number(e.rir,0,10,'RIR',true):null;
   const rest=e.tipo.startsWith('DESCANSO_')?number(e.descanso_seg,0,3600,'Descanso',true):null;
   const at=instant(e.ocorrido_em);
   const saved=await c.query('INSERT INTO public.avn_treino_execucao_eventos(id,execucao_id,tipo,exercicio_id,posicao_exercicio,numero_serie,carga_kg,repeticoes,rir,descanso_seg,ocorrido_em) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(id) DO NOTHING RETURNING id',[e.id,id,e.tipo,exercise,pos,serie,kg,reps,rir,rest,at]);
   if(saved.rowCount)inserted++;else{const r=await c.query('SELECT execucao_id FROM public.avn_treino_execucao_eventos WHERE id=$1',[e.id]);if(!r.rowCount||r.rows[0].execucao_id!==id)throw err('ID de evento duplicado em outro treino.',409);dup++;}
   if(e.tipo==='TREINO_FINALIZADO')await c.query("UPDATE public.avn_treino_execucoes SET status='finalizada',finalizada_em=GREATEST(COALESCE(finalizada_em,$2),$2) WHERE id=$1",[id,at]);
  }
  await c.query('COMMIT');res.json({ok:true,inseridos:inserted,duplicados:dup});
 }catch(e){await c.query('ROLLBACK').catch(()=>{});if(e.code==='23505')throw err('Série já registrada com outro identificador.',409);throw e;}finally{c.release();}
}));
mobile.get('/execucoes/:id',wrap(async(req,res)=>{
 if(!uuid(req.params.id))throw err('Execução inválida.');
 const x=await pool.query('SELECT id,plano_id,dia_semana,iniciada_em,finalizada_em,status FROM public.avn_treino_execucoes WHERE id=$1 AND usuario_id=$2',[req.params.id,req.avnm.usuario_id]);if(!x.rowCount)throw err('Execução não encontrada.',404);
 const events=await pool.query('SELECT id,tipo,exercicio_id,posicao_exercicio,numero_serie,carga_kg,repeticoes,rir,descanso_seg,ocorrido_em FROM public.avn_treino_execucao_eventos WHERE execucao_id=$1 ORDER BY ocorrido_em,id',[req.params.id]);res.json({...x.rows[0],eventos:events.rows});
}));
module.exports={admin,mobile};
