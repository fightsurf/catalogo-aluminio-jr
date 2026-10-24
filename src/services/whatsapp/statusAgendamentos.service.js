'use strict';
const pool = require('../../../db/connection');
const status = require('./status-whatsapp.service');
const videos = require('./statusProdutoVideo.service');
const TZ = 'America/Sao_Paulo';
let schemaPromise;
let working = false;
let started = false;
function schema() {
  if (!schemaPromise) schemaPromise = (async () => {
    await pool.query(`CREATE TABLE IF NOT EXISTS status_agendamento_config (id integer PRIMARY KEY DEFAULT 1 CHECK(id=1), ativo boolean NOT NULL DEFAULT false, intervalo_minutos integer NOT NULL DEFAULT 90, inicio varchar(5) NOT NULL DEFAULT '06:00', fim varchar(5) NOT NULL DEFAULT '22:00', tipo_midia varchar(12) NOT NULL DEFAULT 'foto', categorias jsonb NOT NULL DEFAULT '[]', indice integer NOT NULL DEFAULT 0, proxima_execucao timestamptz, atualizado_em timestamptz NOT NULL DEFAULT now())`);
    await pool.query(`CREATE TABLE IF NOT EXISTS status_agendamento_execucoes (id bigserial PRIMARY KEY, categoria_id integer NOT NULL, categoria_nome text NOT NULL, tipo_midia varchar(12) NOT NULL, estado varchar(20) NOT NULL DEFAULT 'executando', detalhes jsonb NOT NULL DEFAULT '[]', iniciado_em timestamptz NOT NULL DEFAULT now(), finalizado_em timestamptz, erro text)`);
    await pool.query(`INSERT INTO status_agendamento_config(id) VALUES(1) ON CONFLICT DO NOTHING`);
  })().catch(e => {schemaPromise = null; throw e;});
  return schemaPromise;
}
function localParts(date) {
  const parts = new Intl.DateTimeFormat('en-CA',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date);
  return Object.fromEntries(parts.filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
}
function minutes(hhmm) { const [h,m]=hhmm.split(':').map(Number);return h*60+m; }
function inWindow(cfg,date) { const p=localParts(date), n=Number(p.hour)*60+Number(p.minute);return n>=minutes(cfg.inicio) && n<minutes(cfg.fim); }
function nextWindow(cfg, after) {
  // Minute-by-minute timezone-aware search handles midnight and DST without assuming UTC-3.
  let date = new Date(Math.ceil(after.getTime()/60000)*60000);
  for(let i=0;i<60*24*4;i++,date=new Date(date.getTime()+60000)) if(inWindow(cfg,date)) return date;
  throw new Error('Não foi possível calcular a próxima execução.');
}
function validated(body) {
  const interval = Number(body.intervalo_minutos);
  if(!Number.isInteger(interval)||interval<1||interval>10080) throw new Error('Intervalo deve ser de 1 a 10080 minutos.');
  const time=/^(?:[01]\d|2[0-3]):[0-5]\d$/;
  if(!time.test(body.inicio)||!time.test(body.fim)||minutes(body.inicio)>=minutes(body.fim)) throw new Error('Informe uma janela válida, com início anterior ao fim.');
  if(!['foto','video','foto_video'].includes(body.tipo_midia)) throw new Error('Tipo de mídia inválido.');
  if(!Array.isArray(body.categorias)||body.categorias.length>200||new Set(body.categorias.map(Number)).size!==body.categorias.length||body.categorias.some(x=>!Number.isSafeInteger(Number(x))||Number(x)<1)) throw new Error('Categorias inválidas ou repetidas.');
  if(body.ativo && !body.categorias.length) throw new Error('Selecione ao menos uma categoria para ativar.');
  return {ativo:body.ativo===true,intervalo_minutos:interval,inicio:body.inicio,fim:body.fim,tipo_midia:body.tipo_midia,categorias:body.categorias.map(Number)};
}
async function obter() { await schema();const c=(await pool.query('SELECT * FROM status_agendamento_config WHERE id=1')).rows[0];const history=(await pool.query('SELECT id,categoria_id,categoria_nome,tipo_midia,estado,iniciado_em,finalizado_em,erro,detalhes FROM status_agendamento_execucoes ORDER BY id DESC LIMIT 25')).rows;return {config:c,historico:history}; }
async function salvar(body) {
  await schema();const v=validated(body);
  const cats=await status.listarCategorias();const valid=new Set(cats.map(x=>x.id));if(v.categorias.some(x=>!valid.has(x)))throw new Error('Uma das categorias não existe.');
  const client=await pool.connect();try {await client.query('BEGIN');const old=(await client.query('SELECT * FROM status_agendamento_config WHERE id=1 FOR UPDATE')).rows[0];
    const changed=JSON.stringify(old.categorias)!==JSON.stringify(v.categorias);
    const next=v.ativo?nextWindow(v,new Date(Date.now()+60000)):null;
    await client.query(`UPDATE status_agendamento_config SET ativo=$1,intervalo_minutos=$2,inicio=$3,fim=$4,tipo_midia=$5,categorias=$6::jsonb,indice=$7,proxima_execucao=$8,atualizado_em=now() WHERE id=1`,[v.ativo,v.intervalo_minutos,v.inicio,v.fim,v.tipo_midia,JSON.stringify(v.categorias),changed?0:old.indice,next]);await client.query('COMMIT');
  }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}return obter();
}
async function marcarInterrompidos(client) {
  const r=await client.query("UPDATE status_agendamento_execucoes SET estado='revisao', erro=COALESCE(erro,'Execução interrompida: conferir redes antes de reativar.'),finalizado_em=now() WHERE estado='executando' RETURNING id");
  if(r.rowCount) await client.query('UPDATE status_agendamento_config SET ativo=false,proxima_execucao=NULL WHERE id=1');
}
async function tick() {
  if(working)return;working=true;let client, locked=false;
  try {
    await schema();client=await pool.connect();locked=(await client.query('SELECT pg_try_advisory_lock(90677115) AS ok')).rows[0].ok;if(!locked)return;
    await marcarInterrompidos(client);
    const cfg=(await client.query('SELECT * FROM status_agendamento_config WHERE id=1')).rows[0];
    if(!cfg.ativo||!cfg.categorias.length)return;
    if(!cfg.proxima_execucao){await client.query('UPDATE status_agendamento_config SET ativo=false WHERE id=1');return;}
    if(new Date(cfg.proxima_execucao)>new Date())return;
    if(!inWindow(cfg,new Date())) {await client.query('UPDATE status_agendamento_config SET proxima_execucao=$1 WHERE id=1',[nextWindow(cfg,new Date(Date.now()+60000))]);return;}
    const catId=cfg.categorias[cfg.indice%cfg.categorias.length];
    const listing=await status.listarProdutosPorCategoria(catId);
    const job=(await client.query('INSERT INTO status_agendamento_execucoes(categoria_id,categoria_nome,tipo_midia) VALUES($1,$2,$3) RETURNING id',[catId,listing.categoria.nome,cfg.tipo_midia])).rows[0];
    // Reserve the slot before any external side effect. A crash never silently repeats the slot.
    await client.query('UPDATE status_agendamento_config SET proxima_execucao=NULL WHERE id=1');
    let details=[];let error=null;
    for(const product of listing.produtos) {
      if(!product.publicavel && cfg.tipo_midia==='foto' || cfg.tipo_midia==='video'&&!product.publicavel_video || cfg.tipo_midia==='foto_video'&&!product.publicavel_foto&&!product.publicavel_video) {details.push({produto_id:product.id,estado:'ignorado',motivo:product.motivo});continue;}
      const requestId=`agenda-${job.id}-${product.id}`;
      // Persist an uncertain state before calling an external API. Never automatically retry it.
      details.push({produto_id:product.id,estado:'enviando',requestId});
      await client.query('UPDATE status_agendamento_execucoes SET detalhes=$2::jsonb WHERE id=$1',[job.id,JSON.stringify(details)]);
      try {
        let result;
        if(cfg.tipo_midia==='foto') result=await status.publicarProdutoNoStatus({requestId,produtoId:product.id,categoriaId:catId});
        else {
          const p=await status.buscarProdutoParaEnvio(product.id,catId,cfg.tipo_midia);
          await videos.iniciar({requestId,produto:p,tipoMidia:cfg.tipo_midia});
          let attempts=0;
          do {await new Promise(resolve=>setTimeout(resolve,10000));result=await videos.consultar(requestId);attempts++;} while(result.status==='processando'&&attempts<180);
          if(result.status!=='concluido')throw new Error('Vídeo não concluído no prazo; verifique antes de retomar.');
        }
        details[details.length-1]={produto_id:product.id,estado:result.status_geral==='publicado'?'publicado':'parcial',requestId,canais:result.canais};
        if(result.status_geral!=='publicado')throw new Error(`Publicação parcial do produto ${product.id}; verifique os canais.`);
      }catch(e){details[details.length-1].estado='incerto';details[details.length-1].erro=e.message;error=e.message;await client.query('UPDATE status_agendamento_execucoes SET detalhes=$2::jsonb WHERE id=$1',[job.id,JSON.stringify(details)]);break;}
      await client.query('UPDATE status_agendamento_execucoes SET detalhes=$2::jsonb WHERE id=$1',[job.id,JSON.stringify(details)]);
    }
    if(!error && cfg.tipo_midia==='foto') {
      const req=`agenda-${job.id}-feed`;
      details.push({tipo:'feed',estado:'enviando',requestId:req});
      await client.query('UPDATE status_agendamento_execucoes SET detalhes=$2::jsonb WHERE id=$1',[job.id,JSON.stringify(details)]);
      try {const feed=await status.publicarCategoriaFacebook({requestId:req,categoriaId:catId});if(feed.status_geral && feed.status_geral!=='publicado')throw new Error('Publicação do feed não confirmada.');details[details.length-1].estado='publicado';}catch(e){details[details.length-1].estado='incerto';error=e.message;}
    }
    await client.query('UPDATE status_agendamento_execucoes SET estado=$2,detalhes=$3::jsonb,erro=$4,finalizado_em=now() WHERE id=$1',[job.id,error?'revisao':'concluido',JSON.stringify(details),error]);
    // On uncertain external delivery, pause automation instead of risking duplicate posts.
    if(error)await client.query('UPDATE status_agendamento_config SET ativo=false,proxima_execucao=NULL WHERE id=1');
    else await client.query('UPDATE status_agendamento_config SET indice=indice+1,proxima_execucao=$1 WHERE id=1',[nextWindow(cfg,new Date(Date.now()+cfg.intervalo_minutos*60000))]);
  }catch(e){console.error('[Agendamento Status]',e);if(client&&locked) {await client.query('UPDATE status_agendamento_config SET ativo=false,proxima_execucao=NULL WHERE id=1').catch(()=>{});}}
  finally{if(client){if(locked)await client.query('SELECT pg_advisory_unlock(90677115)').catch(()=>{});client.release();}working=false;}
}
function start(){if(started)return;started=true;const timer=setInterval(()=>tick().catch(e=>console.error('[Agendamento Status]',e)),60000);timer.unref?.();setTimeout(()=>tick().catch(e=>console.error('[Agendamento Status]',e)),10000).unref?.();}
module.exports={obter,salvar,start};
