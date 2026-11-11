'use strict';
// Reutiliza o pareamento Android/Watch e token revogável de treinos-mobile.
// A rota pai já validou o Bearer e definiu req.avnm; relógios são bloqueados.
const express = require('express');
const pool = require('../../../db/connection');
const router = express.Router();
const stagesAllowed = new Set(['UNDEFINED','AWAKE','LIGHT','DEEP','REM']);
const bad = (message, status=400) => Object.assign(new Error(message), {status});
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/i;
const date = (value) => {
 if (typeof value !== 'string' || value.length > 40 || !ISO.test(value)) throw bad('Data ISO 8601 inválida.');
 const t = Date.parse(value);
 if (!Number.isFinite(t) || t > Date.now()+86400000 || t < Date.UTC(2000,0,1)) throw bad('Data fora do intervalo.');
 return new Date(t);
};
const integer = (value,min,max,label,optional=false) => {
 if (optional && (value === undefined || value === null)) return null;
 if (!Number.isInteger(value) || value < min || value > max) throw bad(label+' inválido.');
 return value;
};
const validId = s => typeof s === 'string' && s.length >= 1 && s.length <= 240 && !/[\u0000-\u001f]/.test(s);
function parseNight(value) {
 if (!value || typeof value !== 'object' || Array.isArray(value) || !validId(value.external_id)) throw bad('Identificador Samsung inválido.');
 const start=date(value.inicio), end=date(value.fim);
 if (end < start || end-start > 72*3600000) throw bad('Período de sono inválido.');
 const duration=integer(value.duracao_min,0,4320,'Duração',true);
 const score=integer(value.pontuacao,0,100,'Pontuação',true);
 const sessions=integer(value.sessoes_quantidade,0,30,'Quantidade de sessões');
 if (!Array.isArray(value.estagios) || value.estagios.length > 250) throw bad('Fases de sono inválidas.');
 const stages=value.estagios.map(item=>{
   if (!item || !stagesAllowed.has(item.tipo)) throw bad('Tipo de fase desconhecido.');
   const a=date(item.inicio), b=date(item.fim);
   if (b < a || a < start || b > end) throw bad('Horário da fase fora da noite.');
   return {tipo:item.tipo, inicio:a, fim:b};
 }).sort((a,b)=>a.inicio-b.inicio || a.fim-b.fim);
 return {id:value.external_id,start,end,duration,score,sessions,stages};
}
const handler = fn => async(req,res)=>{
 try {
  if (!req.avnm || req.avnm.watchOnly) throw bad('Dispositivo não autorizado.',403);
  await fn(req,res);
 }catch(e) {
  // Não registrar corpo, token, sono ou identificadores nos logs.
  console.error('[AVN sono]', e.status || 500, e.status ? 'Validação rejeitada' : e.code || e.name || 'Erro');
  return res.status(e.status||500).set('Cache-Control','no-store').json({erro:e.status ? e.message : 'Falha ao processar sono.'});
 }
};
router.post('/sincronizar', handler(async(req,res)=>{
 const values=req.body?.noites;
 if (!Array.isArray(values) || values.length<1 || values.length>30) throw bad('Envie de 1 a 30 noites por lote.');
 const nights=values.map(parseNight);
 if (new Set(nights.map(n=>n.id)).size!==nights.length) throw bad('Identificadores repetidos no mesmo lote.');
 const c=await pool.connect(); let inserted=0, updated=0;
 try {
  await c.query('BEGIN');
  for (const n of nights) {
   const result=await c.query(
    "INSERT INTO public.avn_sono_sessoes(usuario_id,origem,registro_externo_id,inicio,fim,duracao_min,pontuacao,sessoes_quantidade) VALUES($1,'samsung_health',$2,$3,$4,$5,$6,$7) ON CONFLICT(usuario_id,origem,registro_externo_id) DO UPDATE SET inicio=EXCLUDED.inicio,fim=EXCLUDED.fim,duracao_min=EXCLUDED.duracao_min,pontuacao=EXCLUDED.pontuacao,sessoes_quantidade=EXCLUDED.sessoes_quantidade,atualizado_em=NOW() RETURNING id,(xmax=0) AS inserido",
    [req.avnm.usuario_id,n.id,n.start,n.end,n.duration,n.score,n.sessions]
   );
   const savedId=result.rows[0].id;
   if (result.rows[0].inserido) inserted++; else updated++;
   await c.query('DELETE FROM public.avn_sono_estagios WHERE sessao_id=$1',[savedId]);
   for (let j=0;j<n.stages.length;j++) {
    const x=n.stages[j];
    await c.query('INSERT INTO public.avn_sono_estagios(sessao_id,posicao,tipo,inicio,fim) VALUES($1,$2,$3,$4,$5)',[savedId,j+1,x.tipo,x.inicio,x.fim]);
   }
  }
  await c.query('COMMIT');
 }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}
 return res.set('Cache-Control','no-store').json({ok:true,recebidos:nights.length,inseridos:inserted,atualizados:updated});
}));
router.get('/', handler(async(req,res)=>{
 const limit=Math.max(1,Math.min(90,Number(req.query.limite)||30));
 const result=await pool.query(
  "SELECT id,inicio,fim,duracao_min,pontuacao,sessoes_quantidade FROM public.avn_sono_sessoes WHERE usuario_id=$1 AND origem='samsung_health' ORDER BY inicio DESC LIMIT $2",
  [req.avnm.usuario_id,limit]
 );
 const ids=result.rows.map(r=>r.id);
 const stages=ids.length ? (await pool.query('SELECT sessao_id,tipo,inicio,fim FROM public.avn_sono_estagios WHERE sessao_id=ANY($1::bigint[]) ORDER BY sessao_id,posicao',[ids])).rows : [];
 return res.set('Cache-Control','no-store').json({noites:result.rows.map(n=>({...n,estagios:stages.filter(s=>String(s.sessao_id)===String(n.id)).map(s=>({tipo:s.tipo,inicio:s.inicio,fim:s.fim}))}))});
}));
module.exports=router;
