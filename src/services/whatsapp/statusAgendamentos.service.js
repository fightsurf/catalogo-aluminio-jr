'use strict';
const pool=require('../../../db/connection');
const status=require('./status-whatsapp.service');
const funil=require('../marketing/funilPublicacoes.service');
const TZ='America/Sao_Paulo';
const LOCK=73241902;
let schemaPromise,started=false,busy=false;
function schema(){
  if(!schemaPromise)schemaPromise=(async()=>{
    await pool.query(`CREATE TABLE IF NOT EXISTS status_agendamento_config (
      id integer PRIMARY KEY DEFAULT 1 CHECK(id=1),ativo boolean NOT NULL DEFAULT false,
      intervalo_minutos integer NOT NULL DEFAULT 90,inicio varchar(5) NOT NULL DEFAULT '06:00',
      fim varchar(5) NOT NULL DEFAULT '22:00',tipo_midia varchar(12) NOT NULL DEFAULT 'foto',
      categorias jsonb NOT NULL DEFAULT '[]',indice integer NOT NULL DEFAULT 0,
      proxima_execucao timestamptz,atualizado_em timestamptz NOT NULL DEFAULT NOW())`);
    await pool.query(`ALTER TABLE status_agendamento_config ADD COLUMN IF NOT EXISTS lote_atual_id BIGINT`);
    await pool.query(`ALTER TABLE status_agendamento_config ADD COLUMN IF NOT EXISTS revisao INTEGER NOT NULL DEFAULT 0`);
    await pool.query('INSERT INTO status_agendamento_config(id) VALUES(1) ON CONFLICT DO NOTHING');
    // História antiga preservada para permitir importar tarefas que ficaram em revisão.
    await pool.query(`CREATE TABLE IF NOT EXISTS status_agendamento_execucoes (
      id bigserial PRIMARY KEY,categoria_id integer NOT NULL,categoria_nome text NOT NULL,
      tipo_midia varchar(12) NOT NULL,estado varchar(20) NOT NULL DEFAULT 'executando',
      detalhes jsonb NOT NULL DEFAULT '[]',iniciado_em timestamptz NOT NULL DEFAULT NOW(),
      finalizado_em timestamptz,erro text)`);
    await funil.table();
  })().catch(e=>{schemaPromise=null;throw e;});
  return schemaPromise;
}
function localParts(date){
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date);
  return Object.fromEntries(parts.filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
}
function minutes(t){const [h,m]=t.split(':').map(Number);return h*60+m;}
function inWindow(cfg,d){const p=localParts(d),n=Number(p.hour)*60+Number(p.minute);return n>=minutes(cfg.inicio)&&n<minutes(cfg.fim);}
function nextWindow(cfg,after){
  let d=new Date(Math.ceil(after.getTime()/60000)*60000);
  for(let i=0;i<60*24*7;i++,d=new Date(d.getTime()+60000))if(inWindow(cfg,d))return d;
  throw new Error('Não foi possível calcular a próxima janela de publicação.');
}
function validate(v){
  const intervalo=Number(v.intervalo_minutos),pat=/^(?:[01]\d|2[0-3]):[0-5]\d$/;
  if(!Number.isInteger(intervalo)||intervalo<1||intervalo>10080)throw new Error('Intervalo de 1 a 10080 minutos.');
  if(!pat.test(v.inicio)||!pat.test(v.fim)||minutes(v.inicio)>=minutes(v.fim))throw new Error('Horário de início e fim inválido.');
  if(!['foto','video','foto_video'].includes(v.tipo_midia))throw new Error('Tipo de mídia inválido.');
  if(!Array.isArray(v.categorias)||v.categorias.length>200)throw new Error('Categorias inválidas.');
  const categorias=v.categorias.map(Number);
  if(categorias.some(c=>!Number.isSafeInteger(c)||c<1)||new Set(categorias).size!==categorias.length)throw new Error('Categorias inválidas ou duplicadas.');
  if(v.ativo===true&&!categorias.length)throw new Error('Selecione ao menos uma categoria.');
  return {ativo:v.ativo===true,intervalo_minutos:intervalo,inicio:v.inicio,fim:v.fim,tipo_midia:v.tipo_midia,categorias};
}
async function obter(){
  await schema();
  const cfg=(await pool.query('SELECT * FROM status_agendamento_config WHERE id=1')).rows[0];
  const novo=(await pool.query(`SELECT l.id,l.categoria_id,l.categoria_nome,l.tipo_midia,l.estado,
    l.criado_em AS iniciado_em,l.encerrado_em AS finalizado_em,
    (SELECT i.erro FROM marketing_fila_itens i WHERE i.lote_id=l.id AND i.erro IS NOT NULL ORDER BY i.id DESC LIMIT 1) AS erro,
    (SELECT count(*)::int FROM marketing_fila_itens i WHERE i.lote_id=l.id AND i.estado='concluido') AS publicados,
    (SELECT count(*)::int FROM marketing_fila_itens i WHERE i.lote_id=l.id) AS total
    FROM marketing_fila_lotes l WHERE l.origem LIKE 'statuszap%' ORDER BY l.id DESC LIMIT 25`)).rows;
  const antigo=(await pool.query(`SELECT id,categoria_id,categoria_nome,tipo_midia,estado,
     iniciado_em,finalizado_em,erro,detalhes FROM status_agendamento_execucoes ORDER BY id DESC LIMIT 15`)).rows;
  const historie=[...novo.map(l=>({...l,origem:'funil',estado:l.estado==='pendencias'?'com_pendencias':l.estado==='pendente'?'executando':l.estado})),
    ...antigo.map(l=>({...l,origem:'legado'}))]
      .sort((a,b)=>new Date(b.iniciado_em)-new Date(a.iniciado_em)).slice(0,30);
  return {config:cfg,historico:historie,funil:await funil.painel()};
}
async function salvar(body){
  await schema();const v=validate(body);
  const list=await status.listarCategorias();const valid=new Set(list.map(x=>x.id));
  if(v.categorias.some(x=>!valid.has(x)))throw new Error('Categoria não encontrada.');
  const db=await pool.connect();
  try {
    await db.query('BEGIN');
    const old=(await db.query('SELECT * FROM status_agendamento_config WHERE id=1 FOR UPDATE')).rows[0];
    const naoResolvido=(await db.query(`SELECT id FROM status_agendamento_execucoes WHERE estado IN ('revisao','executando') ORDER BY id DESC LIMIT 1`)).rows[0];
    if(v.ativo && naoResolvido && !old.lote_atual_id)throw new Error(`Existe uma execução antiga (nº ${naoResolvido.id}) com publicações pendentes. Use “Recuperar execução antiga” antes de ativar, para evitar duplicações.`);
    const changed=JSON.stringify(old.categorias)!==JSON.stringify(v.categorias);
    const next= !v.ativo || old.lote_atual_id ? null : nextWindow(v,new Date(Date.now()+60000));
    await db.query(`UPDATE status_agendamento_config SET ativo=$1,intervalo_minutos=$2,inicio=$3,
      fim=$4,tipo_midia=$5,categorias=$6::jsonb,indice=$7,revisao=revisao+$8,
      proxima_execucao=$9,atualizado_em=NOW() WHERE id=1`,
      [v.ativo,v.intervalo_minutos,v.inicio,v.fim,v.tipo_midia,JSON.stringify(v.categorias),changed?0:old.indice,changed?1:0,next]);
    await db.query('COMMIT');
  }catch(e){await db.query('ROLLBACK').catch(()=>{});throw e;}finally{db.release();}
  return obter();
}
async function migrarLegado(id) {
  await schema();if(!Number.isSafeInteger(Number(id))||Number(id)<=0)throw new Error('Execução inválida.');
  const guard=await pool.connect();let guardLocked=false;
  try {
    // Mesmo lock do agendador original. Aguarda encerrar a execução antiga antes de fotografar seu progresso.
    guardLocked=(await guard.query('SELECT pg_try_advisory_lock(90677115) AS ok')).rows[0].ok;
    if(!guardLocked)throw new Error('Ainda há uma publicação anterior em andamento. Aguarde para recuperar.');
  const r=(await pool.query('SELECT * FROM status_agendamento_execucoes WHERE id=$1',[id])).rows[0];
  if(!r || !['revisao','executando'].includes(r.estado))throw new Error('Essa execução não está pendente de recuperação.');
  // Produtos ainda não tentados: seguros para continuar. Tentativa incerta: intervenção obrigatória.
  const listing=await status.listarProdutosPorCategoria(r.categoria_id);
  const anteriores=Array.isArray(r.detalhes)?r.detalhes:[];
  const porId=new Map(anteriores.filter(x=>x.produto_id).map(x=>[Number(x.produto_id),x]));
  const videoJobs=new Map();
  if(['video','foto_video'].includes(r.tipo_midia)) {
    try {
      const ids=anteriores.filter(x=>x.produto_id&&x.requestId).map(x=>x.requestId);
      if(ids.length){
        const jobs=await pool.query('SELECT request_id,dados FROM status_produto_video_jobs WHERE request_id=ANY($1::text[])',[ids]);
        for(const job of jobs.rows)videoJobs.set(job.request_id,job.dados);
      }
    }catch(e){console.error('[Agendamento] Histórico de vídeo indisponível:',e.message);}
  }
  function estadoLegado(prev,idProduto){
    if(!prev)return null;
    if(prev.estado==='publicado')return 'concluido';
    if(prev.estado==='ignorado')return 'ignorado';
    const video=videoJobs.get(prev.requestId||`agenda-${r.id}-${idProduto}`);
    if(video) {
      if(video.status==='concluido')return 'concluido';
      if(video.status==='processando')return 'aguardando_video';
      if(video.status==='erro') {
        const partes=(video.partes||[]).some(p=>Object.values(p.canais||{}).some(c=>c.status==='incerto'));
        const foto=Object.values(video.fotos||{}).some(c=>c.status==='incerto');
        return (partes||foto)?'incerto':'aguardando_retry';
      }
    }
    return 'incerto';
  }
  const itens=listing.produtos.map(p=>{
    const prev=porId.get(p.id);
    const naoPublicavel=r.tipo_midia==='foto'?!p.publicavel_foto:r.tipo_midia==='video'?!p.publicavel_video:!p.publicavel_foto&&!p.publicavel_video;
    const estado=prev?estadoLegado(prev,p.id):naoPublicavel?'ignorado':'pendente';
    return {tipo:'statuszap_produto',produtoId:p.id,produtoNome:p.nome,requestId:prev?.requestId||`agenda-${r.id}-${p.id}`,
      estado,detalhes:{importado_de:r.id,estado_anterior:prev?.estado||'nao_iniciado'}};
  });
  const vistos=new Set(listing.produtos.map(p=>p.id));
  for(const old of anteriores.filter(x=>x.produto_id && !vistos.has(Number(x.produto_id)))) {
    itens.push({tipo:'statuszap_produto',produtoId:Number(old.produto_id),
      produtoNome:`Produto nº ${old.produto_id} (não está mais na categoria)`,
      requestId:old.requestId||`agenda-${r.id}-${old.produto_id}`,estado:estadoLegado(old,old.produto_id)==='concluido'?'concluido':'incerto',
      detalhes:{importado_de:r.id,estado_anterior:old.estado,alerta:'Produto ausente do catálogo atual; verifique manualmente.'}});
  }
  if(r.tipo_midia==='foto') {
    const prev=anteriores.find(x=>x.tipo==='feed');
    itens.push({tipo:'statuszap_feed',requestId:prev?.requestId||`agenda-${r.id}-feed`,
      estado:prev?.estado==='publicado'?'concluido':prev?'incerto':'pendente',detalhes:{importado_de:r.id}});
  }
  const db=await pool.connect();
  try {
    await db.query('BEGIN');
    const antigo=(await db.query('SELECT * FROM status_agendamento_execucoes WHERE id=$1 FOR UPDATE',[id])).rows[0];
    if(!['revisao','executando'].includes(antigo.estado))throw new Error('Execução já recuperada.');
    const emUso=(await db.query('SELECT lote_atual_id FROM status_agendamento_config WHERE id=1 FOR UPDATE')).rows[0];
    if(emUso?.lote_atual_id)throw new Error('Aguarde o término da categoria que já está no funil antes de recuperar outra execução.');
    const novo=await funil.enfileirarLote({origem:'statuszap_legado',chaveOrigem:`statuszap:legado:${id}`,
      categoriaId:r.categoria_id,categoriaNome:r.categoria_nome,tipoMidia:r.tipo_midia,itens,metadados:{legado_id:Number(id)}},db);
    // Nos registros antigos de fotos, aproveitar confirmações por canal que já foram gravadas.
    // Se o servidor caiu antes de gravá-las, os canais permanecem incertos.
    if(r.tipo_midia==='foto') for(const item of itens) {
      if(item.tipo!=='statuszap_produto'||item.estado!=='incerto')continue;
      const anterior=porId.get(Number(item.produtoId));
      const filaItem=(await db.query('SELECT id FROM marketing_fila_itens WHERE lote_id=$1 AND request_id=$2',
        [novo.id,item.requestId])).rows[0];
      for(const canal of ['whatsapp','instagram','facebook_story']){
        const state=anterior?.canais?.[canal]?.status==='publicado'?'publicado':'incerto';
        await db.query(`INSERT INTO marketing_fila_canais(item_id,canal,estado,erro) VALUES($1,$2,$3,$4)
          ON CONFLICT(item_id,canal) DO NOTHING`,[filaItem.id,canal,state,state==='incerto'?'Resultado do agendador antigo sem confirmação.':null]);
      }
    }
    await db.query("UPDATE status_agendamento_execucoes SET estado='migrado',finalizado_em=COALESCE(finalizado_em,NOW()) WHERE id=$1",[id]);
    // O lote importado substitui a categoria interrompida. Não avance o índice até sua conclusão.
    const cfg=(await db.query('SELECT * FROM status_agendamento_config WHERE id=1 FOR UPDATE')).rows[0];
    if(!cfg.lote_atual_id)await db.query('UPDATE status_agendamento_config SET lote_atual_id=$1,proxima_execucao=NULL WHERE id=1',[novo.id]);
    await funil.event(db,{loteId:novo.id,nivel:'aviso',codigo:'LEGADO_IMPORTADO',mensagem:`Execução antiga ${id} importada: itens incertos exigem conferência; itens não iniciados continuam pela fila.`});
    await db.query('COMMIT');return {lote_id:novo.id};
  }catch(e){await db.query('ROLLBACK').catch(()=>{});throw e;}finally{db.release();}  } finally {
    if(guardLocked)await guard.query('SELECT pg_advisory_unlock(90677115)').catch(()=>{});
    guard.release();
  }
}
async function tick(){
  if(busy)return;busy=true;let db,lock=false;
  try {
    await schema();db=await pool.connect();
    lock=(await db.query('SELECT pg_try_advisory_lock($1) AS ok',[LOCK])).rows[0].ok;
    if(!lock)return;
    await db.query('BEGIN');
    const cfg=(await db.query('SELECT * FROM status_agendamento_config WHERE id=1 FOR UPDATE')).rows[0];
    if(!cfg.ativo||!cfg.categorias.length) {await db.query('COMMIT');return;}
    if(cfg.lote_atual_id){await db.query('COMMIT');return;}
    // Respeita a interrupção do agendador antigo, que pode ter efetuado envios sem confirmação.
    const legado=(await db.query("SELECT id FROM status_agendamento_execucoes WHERE estado IN ('revisao','executando') ORDER BY id DESC LIMIT 1")).rows[0];
    if(legado){await db.query('COMMIT');await migrarLegado(legado.id);return;}
    if(!cfg.proxima_execucao){await db.query('UPDATE status_agendamento_config SET proxima_execucao=$1 WHERE id=1',[nextWindow(cfg,new Date(Date.now()+60000))]);await db.query('COMMIT');return;}
    if(new Date(cfg.proxima_execucao)>new Date()){await db.query('COMMIT');return;}
    if(!inWindow(cfg,new Date())){await db.query('UPDATE status_agendamento_config SET proxima_execucao=$1 WHERE id=1',[nextWindow(cfg,new Date(Date.now()+60000))]);await db.query('COMMIT');return;}
    const catId=cfg.categorias[cfg.indice%cfg.categorias.length];
    const listing=await status.listarProdutosPorCategoria(catId);
    const itens=listing.produtos.map(p=>({tipo:'statuszap_produto',produtoId:p.id,produtoNome:p.nome,
      estado:cfg.tipo_midia==='foto'?!p.publicavel_foto? 'ignorado':'pendente':cfg.tipo_midia==='video'?!p.publicavel_video?'ignorado':'pendente':!p.publicavel_foto&&!p.publicavel_video?'ignorado':'pendente'}));
    if(cfg.tipo_midia==='foto')itens.push({tipo:'statuszap_feed'});
    const chave=(await db.query("SELECT nextval('marketing_fila_lotes_id_seq')::text AS n")).rows[0].n;
    const novo=await funil.enfileirarLote({origem:'statuszap_agendamento',
      chaveOrigem:`statuszap:agenda:${chave}`,
      categoriaId:catId,categoriaNome:listing.categoria.nome,tipoMidia:cfg.tipo_midia,itens,
      metadados:{revisao:cfg.revisao}},db);
    await db.query('UPDATE status_agendamento_config SET lote_atual_id=$1,proxima_execucao=NULL WHERE id=1',[novo.id]);
    await db.query('COMMIT');
  } catch(e) {if(db)await db.query('ROLLBACK').catch(()=>{});console.error('[Agendamento Status]',e);}
  finally {if(db){if(lock)await db.query('SELECT pg_advisory_unlock($1)',[LOCK]).catch(()=>{});db.release();}busy=false;}
}
function start(){
  if(started)return;started=true;
  funil.start();
  const timer=setInterval(()=>tick().catch(e=>console.error('[Agendamento Status]',e)),15000);
  timer.unref?.();setTimeout(()=>tick().catch(e=>console.error('[Agendamento Status]',e)),10000).unref?.();
}
module.exports={obter,salvar,tick,start,schema,nextWindow,migrarLegado};
