'use strict';
const pool=require('../../../db/connection');
const funil=require('./funilPublicacoes.service');
const catalogo=require('./republicador-youtube.catalogo');
const TZ='America/Fortaleza',LOCK=80612743,MODULOS=['youtube','ofertas'];
let promise,started=false,busy=false;
const erro=e=>String(e?.message||e).replace(/https?:\/\/\S+/gi,'[URL]').slice(0,400);
function parts(d){return Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:TZ,
  hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(d).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));}
const minute=t=>Number(t.slice(0,2))*60+Number(t.slice(3));
function inWindow(c,d){const p=parts(d),n=Number(p.hour)*60+Number(p.minute);return n>=minute(c.inicio)&&n<minute(c.fim);}
function nextWindow(c,after){
  let d=new Date(Math.ceil(after.getTime()/60000)*60000);
  for(let i=0;i<10080;i++,d=new Date(d.getTime()+60000))if(inWindow(c,d))return d;
  throw new Error('Janela inválida.');
}
async function schema(){
  if(!promise)promise=(async()=>{
    await pool.query(`CREATE TABLE IF NOT EXISTS marketing_agendadores_modulos(
      modulo TEXT PRIMARY KEY CHECK(modulo IN ('youtube','ofertas')),ativo BOOLEAN NOT NULL DEFAULT FALSE,
      intervalo_minutos INTEGER NOT NULL DEFAULT 90,inicio VARCHAR(5) NOT NULL DEFAULT '06:00',
      fim VARCHAR(5) NOT NULL DEFAULT '22:00',proxima_execucao TIMESTAMPTZ,
      ultimo_video_id VARCHAR(11),ultima_oferta_id BIGINT,ultimo_sucesso_em TIMESTAMPTZ,
      ultimo_erro TEXT,atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    await pool.query(`CREATE TABLE IF NOT EXISTS marketing_publicacao_ritmo(
      id INTEGER PRIMARY KEY DEFAULT 1 CHECK(id=1),
      intervalo_global_minutos INTEGER NOT NULL DEFAULT 15,
      ultimo_item_id BIGINT,ultima_reserva_em TIMESTAMPTZ,atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    await pool.query('INSERT INTO marketing_publicacao_ritmo(id) VALUES(1) ON CONFLICT DO NOTHING');
    for(const m of MODULOS)await pool.query('INSERT INTO marketing_agendadores_modulos(modulo) VALUES($1) ON CONFLICT DO NOTHING',[m]);
    await funil.table();
  })().catch(e=>{promise=null;throw e;});
  return promise;
}
function checkModulo(m){if(!MODULOS.includes(m))throw new Error('Agendador inválido.');return m;}
function validar(data){
  const n=Number(data.intervalo_minutos),g=Number(data.intervalo_global_minutos),re=/^(?:[01]\d|2[0-3]):[0-5]\d$/;
  if(!Number.isInteger(n)||n<1||n>10080)throw new Error('Intervalo de 1 a 10080 minutos.');
  if(!Number.isInteger(g)||g<1||g>1440)throw new Error('Pausa global de 1 a 1440 minutos.');
  if(!re.test(data.inicio)||!re.test(data.fim)||minute(data.inicio)>=minute(data.fim))throw new Error('Horários inválidos.');
  return {ativo:data.ativo===true,intervalo_minutos:n,inicio:data.inicio,fim:data.fim,intervalo_global_minutos:g};
}
async function obter(modulo){
  checkModulo(modulo);await schema();
  const [cfg,pace,pending,last]=await Promise.all([
    pool.query('SELECT * FROM marketing_agendadores_modulos WHERE modulo=$1',[modulo]),
    pool.query('SELECT * FROM marketing_publicacao_ritmo WHERE id=1'),
    pool.query(`SELECT i.id,i.estado,i.erro,i.produto_nome,i.atualizado_em FROM marketing_fila_itens i
      JOIN marketing_fila_lotes l ON l.id=i.lote_id WHERE l.origem=$1 AND i.estado NOT IN ('concluido','ignorado')
      ORDER BY i.id LIMIT 1`,[modulo+'_agenda']),
    pool.query(`SELECT i.produto_nome,i.request_id,i.atualizado_em FROM marketing_fila_itens i
      JOIN marketing_fila_lotes l ON l.id=i.lote_id WHERE l.origem=$1 AND i.estado='concluido'
      ORDER BY i.atualizado_em DESC LIMIT 1`,[modulo+'_agenda'])
  ]);
  return {config:cfg.rows[0],intervalo_global_minutos:pace.rows[0].intervalo_global_minutos,
    pendencia:pending.rows[0]||null,ultimo_publicado:last.rows[0]||null,
    ultima_reserva_global:pace.rows[0].ultima_reserva_em};
}
async function salvar(modulo,data){
  checkModulo(modulo);await schema();const v=validar(data),db=await pool.connect();
  try{
    await db.query('BEGIN');
    await db.query('SELECT 1 FROM marketing_agendadores_modulos WHERE modulo=$1 FOR UPDATE',[modulo]);
    await db.query(`UPDATE marketing_agendadores_modulos SET ativo=$2,intervalo_minutos=$3,inicio=$4,fim=$5,
      proxima_execucao=$6,ultimo_erro=NULL,atualizado_em=NOW() WHERE modulo=$1`,
      [modulo,v.ativo,v.intervalo_minutos,v.inicio,v.fim,
        v.ativo?nextWindow(v,new Date(Date.now()+60000)):null]);
    await db.query('UPDATE marketing_publicacao_ritmo SET intervalo_global_minutos=$1,atualizado_em=NOW() WHERE id=1',
      [v.intervalo_global_minutos]);
    await db.query('COMMIT');
  }catch(e){await db.query('ROLLBACK').catch(()=>{});throw e;}finally{db.release();}
  return obter(modulo);
}
function duration(iso){
  const m=String(iso||'').match(/^P(?:\d+D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  return m?Number(m[1]||0)*3600+Number(m[2]||0)*60+Number(m[3]||0):0;
}
async function proximoVideo(db){
  let token='',lista=[],n=0;
  do{
    const p=await catalogo.listar(token);
    lista.push(...p.videos);token=p.proxima_pagina||'';
    if(++n>60)throw new Error('Mais de 3000 vídeos: excedeu a paginação de segurança.');
  }while(token);
  lista=lista.filter(v=>duration(v.duracao_iso)>=3&&duration(v.duracao_iso)<=660)
    .sort((a,b)=>new Date(a.data)-new Date(b.data)||a.id.localeCompare(b.id));
  for(const v of lista){
    const r=await db.query(`SELECT EXISTS(SELECT 1 FROM marketing_fila_itens WHERE request_id=$1) AS enfileirado,
      EXISTS(SELECT 1 FROM marketing_republicador_youtube WHERE youtube_video_id=$2 AND
      modo='publicar' AND estado='concluido') AS publicado`,['youtube-auto-'+v.id,v.id]);
    if(!r.rows[0].enfileirado&&!r.rows[0].publicado)return v;
  }
  return null;
}
async function proximaOferta(db){
  const r=await db.query(`SELECT id,titulo,created_at FROM ofertas o
    WHERE NOT EXISTS(SELECT 1 FROM marketing_fila_itens i WHERE i.request_id='ofertas-auto-'||o.id::text)
    AND COALESCE(whatsapp_status,'nao_publicado')='nao_publicado'
    AND COALESCE(instagram_status,'nao_publicado')='nao_publicado'
    AND COALESCE(facebook_story_status,'nao_publicado')='nao_publicado'
    AND COALESCE(facebook_feed_status,'nao_publicado')='nao_publicado'
    ORDER BY created_at,id LIMIT 1`);
  return r.rows[0]||null;
}
async function progresso(db,modulo){
  const r=await db.query(`SELECT i.* FROM marketing_fila_itens i JOIN marketing_fila_lotes l ON l.id=i.lote_id
    WHERE l.origem=$1 AND i.estado='concluido' ORDER BY i.atualizado_em DESC LIMIT 1`,[modulo+'_agenda']);
  if(!r.rows.length)return;
  const i=r.rows[0];
  await db.query(`UPDATE marketing_agendadores_modulos SET
    ultimo_video_id=CASE WHEN modulo='youtube' THEN $2 ELSE ultimo_video_id END,
    ultima_oferta_id=CASE WHEN modulo='ofertas' THEN $3 ELSE ultima_oferta_id END,
    ultimo_sucesso_em=GREATEST(COALESCE(ultimo_sucesso_em,'epoch'::timestamptz),$4::timestamptz)
    WHERE modulo=$1`,[modulo,modulo==='youtube'?i.request_id.slice('youtube-auto-'.length):null,
      modulo==='ofertas'?i.produto_id:null,i.atualizado_em]);
}
async function tick(){
  if(busy)return;busy=true;let db,locked=false;
  try{
    await schema();db=await pool.connect();
    locked=(await db.query('SELECT pg_try_advisory_lock($1) AS ok',[LOCK])).rows[0].ok;
    if(!locked)return;
    for(const modulo of MODULOS){
      await progresso(db,modulo);
      const cfg=(await db.query('SELECT * FROM marketing_agendadores_modulos WHERE modulo=$1',[modulo])).rows[0];
      if(!cfg.ativo||!cfg.proxima_execucao||new Date(cfg.proxima_execucao)>new Date())continue;
      if(!inWindow(cfg,new Date())){
        await db.query('UPDATE marketing_agendadores_modulos SET proxima_execucao=$2 WHERE modulo=$1',
          [modulo,nextWindow(cfg,new Date(Date.now()+60000))]);continue;
      }
      const pendente=await db.query(`SELECT 1 FROM marketing_fila_itens i
        JOIN marketing_fila_lotes l ON l.id=i.lote_id WHERE l.origem=$1
        AND i.estado NOT IN ('concluido','ignorado') LIMIT 1`,[modulo+'_agenda']);
      if(pendente.rowCount)continue;
      const v=modulo==='youtube'?await proximoVideo(db):await proximaOferta(db);
      if(v){
        await funil.enfileirarLote({origem:modulo+'_agenda',chaveOrigem:modulo+':agenda:'+v.id,
          categoriaNome:modulo==='youtube'?'YouTube':'Kits feirinha',
          tipoMidia:modulo==='youtube'?'video':'foto',
          itens:[modulo==='youtube'
            ?{tipo:'youtube_video',produtoNome:v.titulo,requestId:'youtube-auto-'+v.id,
              detalhes:{youtube_video_id:v.id,data_publicacao:v.data}}
            :{tipo:'oferta_kit',produtoId:Number(v.id),produtoNome:v.titulo,
              requestId:'ofertas-auto-'+v.id,detalhes:{data_criacao:v.created_at}}],
          metadados:{agendamento:true}});
      }
      await db.query(`UPDATE marketing_agendadores_modulos SET proxima_execucao=$2,ultimo_erro=NULL,
        atualizado_em=NOW() WHERE modulo=$1`,
        [modulo,nextWindow(cfg,new Date(Date.now()+cfg.intervalo_minutos*60000))]);
    }
  }catch(e){
    console.error('[Agendadores marketing]',erro(e));
    // Erros de coleta interrompem o disparo automático até o operador reativar.
    if(db)await db.query(`UPDATE marketing_agendadores_modulos SET ativo=FALSE,proxima_execucao=NULL,
      ultimo_erro=$1,atualizado_em=NOW() WHERE ativo=TRUE`,[erro(e)]).catch(()=>{});
  }finally{
    if(db){if(locked)await db.query('SELECT pg_advisory_unlock($1)',[LOCK]).catch(()=>{});db.release();}
    busy=false;
  }
}
function iniciar(){
  if(started)return;started=true;
  const t=setInterval(()=>tick().catch(e=>console.error('[Agendadores marketing]',erro(e))),30000);
  t.unref?.();
  setTimeout(()=>tick().catch(e=>console.error('[Agendadores marketing]',erro(e))),12000).unref?.();
}
module.exports={obter,salvar,tick,iniciar,schema,nextWindow,duration};
