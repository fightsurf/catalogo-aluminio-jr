'use strict';
// API para registros de treino do Samsung Health, pelo token pareado do Android.
const express=require('express');
const pool=require('../../../db/connection');
const router=express.Router();
const bad=(message,status=400)=>Object.assign(new Error(message),{status});
function parseWorkout(raw) {
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||
    typeof raw.external_id!=='string'||!raw.external_id.trim()||
    raw.external_id.length>240)throw bad('Identificador inválido.');
 const dates=[raw.inicio,raw.fim].map(value=>{
  if(typeof value!=='string'||value.length>40||!(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d/).test(value))throw bad('Horário inválido.');
  const n=Date.parse(value);
  if(!Number.isFinite(n)||n>Date.now()+86400000||n<Date.now()-366*86400000)throw bad('Data fora do período.');
  return new Date(n);
 });
 if(dates[1]<dates[0]||dates[1]-dates[0]>24*3600000)throw bad('Intervalo inválido.');
 const kcal=raw.calorias_kcal;
 if(typeof kcal!=='number'||!Number.isFinite(kcal)||kcal<0||kcal>10000)throw bad('Calorias inválidas.');
 return {id:raw.external_id,start:dates[0],end:dates[1],kcal,kind:String(raw.tipo_atividade||'').slice(0,120)};
}
router.post('/sincronizar',async(req,res)=>{
 try{
  if(!req.avnm||req.avnm.watchOnly)throw bad('Dispositivo não autorizado.',403);
  const data=req.body?.treinos;
  if(!Array.isArray(data)||data.length<1||data.length>100)throw bad('Lote inválido.');
  const records=data.map(parseWorkout);
  if(new Set(records.map(x=>x.id)).size!==records.length)throw bad('IDs repetidos.');
  const client=await pool.connect();let inserted=0,updated=0;
  try{
   await client.query('BEGIN');
   for(const x of records){
    const q=await client.query(
     "INSERT INTO public.avn_atividades(usuario_id,inicio,fim,tipo_atividade,titulo,origem,aplicativo_origem,registro_externo_id,calorias_kcal) "+
     "VALUES($1,$2,$3,$4,'Treino Samsung Health','samsung_health','com.sec.android.app.shealth',$5,$6) "+
     "ON CONFLICT (usuario_id,origem,aplicativo_origem,registro_externo_id) WHERE registro_externo_id IS NOT NULL "+
     "DO UPDATE SET inicio=EXCLUDED.inicio,fim=EXCLUDED.fim,tipo_atividade=EXCLUDED.tipo_atividade,calorias_kcal=EXCLUDED.calorias_kcal,atualizado_em=NOW() "+
     "RETURNING (xmax=0) AS inserted",
     [req.avnm.usuario_id,x.start,x.end,x.kind,x.id,x.kcal]);
    if(q.rows[0].inserted)inserted++;else updated++;
   }
   await client.query('COMMIT');
  }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}
  return res.set('Cache-Control','no-store').json({ok:true,recebidos:records.length,inseridos:inserted,atualizados:updated});
 }catch(e){
  console.error('[AVN Samsung exercícios]',e.status||500,e.status?'Validação':'Falha do banco');
  return res.status(e.status||500).set('Cache-Control','no-store').json({erro:e.status?e.message:'Falha ao gravar treinos.'});
 }
});
router._parseWorkout=parseWorkout;
module.exports=router;
