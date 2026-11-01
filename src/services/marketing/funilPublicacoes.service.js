'use strict';
// Funil central de marketing. Os adaptadores de outros módulos usarão enfileirarLote().
// PostgreSQL é a fonte da verdade: nunca reexecutar um envio externo sem confirmar o estado.
const pool = require('../../../db/connection');
const crypto=require('node:crypto');
const status = require('../whatsapp/status-whatsapp.service');
const videos = require('../whatsapp/statusProdutoVideo.service');
const zap = require('../integracoes/zapi.service');
const termometro = require('../termometro/termometroAparicoes.service');

// Mesmo lock usado pelo agendador legado: impede publicação simultânea no deploy de transição.
const LOCK = 90677115;
const CANAIS = ['whatsapp', 'instagram', 'facebook_story'];
const TERMINAIS = ['concluido', 'ignorado', 'incerto', 'atencao'];
const LIMITE_TENTATIVAS = 5;
let schemaPromise;
let started = false;
let busy = false;
function cleanError(e) {
  return String(e?.message || e || 'Erro não especificado')
    .replace(/https?:\/\/[^\s)]+/gi, '[URL omitida]')
    .replace(/(?:Bearer\s+|token[=:]\s*)[^\s,;]+/gi, '[credencial omitida]')
    .slice(0, 1200);
}
function json(value) { return JSON.stringify(value === undefined ? null : value); }
function table() {
  if (!schemaPromise) schemaPromise = (async () => {
    await pool.query(`CREATE TABLE IF NOT EXISTS marketing_fila_lotes (
      id BIGSERIAL PRIMARY KEY, origem TEXT NOT NULL, chave_origem TEXT NOT NULL UNIQUE,
      categoria_id INTEGER, categoria_nome TEXT, tipo_midia TEXT,
      estado TEXT NOT NULL DEFAULT 'pendente', metadados JSONB NOT NULL DEFAULT '{}'::jsonb,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(), encerrado_em TIMESTAMPTZ
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS marketing_fila_itens (
      id BIGSERIAL PRIMARY KEY, lote_id BIGINT NOT NULL REFERENCES marketing_fila_lotes(id),
      ordem INTEGER NOT NULL, tipo TEXT NOT NULL,
      produto_id INTEGER, produto_nome TEXT, request_id TEXT NOT NULL UNIQUE,
      estado TEXT NOT NULL DEFAULT 'pendente', tentativas INTEGER NOT NULL DEFAULT 0,
      proxima_tentativa TIMESTAMPTZ, erro TEXT, detalhes JSONB NOT NULL DEFAULT '{}'::jsonb,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(), atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(lote_id,ordem)
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS marketing_fila_canais (
      item_id BIGINT NOT NULL REFERENCES marketing_fila_itens(id),
      canal TEXT NOT NULL, estado TEXT NOT NULL DEFAULT 'pendente', tentativas INTEGER NOT NULL DEFAULT 0,
      resultado JSONB, erro TEXT, atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(item_id,canal)
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS marketing_fila_eventos (
      id BIGSERIAL PRIMARY KEY, lote_id BIGINT REFERENCES marketing_fila_lotes(id),
      item_id BIGINT REFERENCES marketing_fila_itens(id),
      nivel TEXT NOT NULL, codigo TEXT NOT NULL, mensagem TEXT NOT NULL,
      detalhes JSONB NOT NULL DEFAULT '{}'::jsonb, criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await pool.query('CREATE INDEX IF NOT EXISTS marketing_fila_itens_ordem_idx ON marketing_fila_itens(lote_id,ordem,estado)');
    await pool.query('CREATE INDEX IF NOT EXISTS marketing_fila_eventos_ordem_idx ON marketing_fila_eventos(criado_em DESC,id DESC)');
  })().catch(e => { schemaPromise = null; throw e; });
  return schemaPromise;
}
async function evento(db, {loteId=null,itemId=null,nivel='info',codigo,mensagem,detalhes={}}) {
  await db.query(`INSERT INTO marketing_fila_eventos(lote_id,item_id,nivel,codigo,mensagem,detalhes)
                  VALUES($1,$2,$3,$4,$5,$6::jsonb)`,
    [loteId,itemId,nivel,codigo,String(mensagem).slice(0,1200),json(detalhes)]);
}
async function enfileirarLote({origem,chaveOrigem,categoriaId=null,categoriaNome=null,tipoMidia=null,itens,metadados={}}, db=null) {
  await table();
  if(!db) {
    const client=await pool.connect();
    try {
      await client.query('BEGIN');
      const result=await enfileirarLote({origem,chaveOrigem,categoriaId,categoriaNome,tipoMidia,itens,metadados},client);
      await client.query('COMMIT');return result;
    } catch(error) {await client.query('ROLLBACK').catch(()=>{});throw error;}
    finally{client.release();}
  }

  if(!/^[a-z0-9_-]{3,45}$/.test(origem) || !/^[a-z0-9:._-]{5,140}$/i.test(chaveOrigem)) throw new Error('Origem ou chave inválida.');
  if(!Array.isArray(itens) || itens.length>1000) throw new Error('Lote inválido ou grande demais.');
  const r = await db.query(`INSERT INTO marketing_fila_lotes(origem,chave_origem,categoria_id,categoria_nome,tipo_midia,metadados)
     VALUES($1,$2,$3,$4,$5,$6::jsonb) ON CONFLICT(chave_origem) DO NOTHING RETURNING id`,
  [origem,chaveOrigem,categoriaId,categoriaNome,tipoMidia,json(metadados)]);
  if(!r.rows.length) {
    const old=await db.query('SELECT * FROM marketing_fila_lotes WHERE chave_origem=$1',[chaveOrigem]);
    return {id:Number(old.rows[0].id),ja_existia:true};
  }
  const id=Number(r.rows[0].id);
  for(let i=0;i<itens.length;i++) {
    const task=itens[i];
    if(!['statuszap_produto','statuszap_feed','youtube_video','oferta_kit'].includes(task.tipo)) throw new Error('Adaptador de tarefa desconhecido.');
    const requestId=task.requestId || `funil-${id}-${i+1}`;
    await db.query(`INSERT INTO marketing_fila_itens(lote_id,ordem,tipo,produto_id,produto_nome,request_id,estado,detalhes)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
      [id,i,task.tipo,task.produtoId||null,task.produtoNome||null,requestId,task.estado||'pendente',json(task.detalhes||{})]);
  }
  await evento(db,{loteId:id,codigo:'LOTE_CRIADO',mensagem:`${itens.length} tarefa(s) registradas no funil.`,detalhes:{origem,chaveOrigem}});
  return {id,ja_existia:false};
}
async function atualizar(db,item,estado,{erro=null,detalhes=null,tentativaEm=null}={}) {
  await db.query(`UPDATE marketing_fila_itens SET estado=$2,erro=$3,
      detalhes=COALESCE($4::jsonb,detalhes),proxima_tentativa=$5,atualizado_em=NOW() WHERE id=$1`,
    [item.id,estado,erro,detalhes===null?null:json(detalhes),tentativaEm]);
}
function retryDelay(tentativas) { return Math.min(60,2**Math.min(6,Math.max(0,tentativas-1))) * 60000; }
async function retryOrAttention(db,item,erro,{codigo='TENTATIVA_FALHOU',detalhes={}}={}) {
  const tentativas=Number(item.tentativas||0);
  const exhausted=tentativas>=LIMITE_TENTATIVAS;
  await atualizar(db,item,exhausted?'atencao':'aguardando_retry',
    {erro,tentativaEm:exhausted?null:new Date(Date.now()+retryDelay(tentativas))});
  await evento(db,{loteId:item.lote_id,itemId:item.id,nivel:'erro',codigo,mensagem:erro,
    detalhes:{tentativas,limite:LIMITE_TENTATIVAS,...detalhes}});
}
async function incerto(db,item,erro,detalhes) {
  await atualizar(db,item,'incerto',{erro,detalhes});
  await db.query('UPDATE marketing_publicacao_ritmo SET ultima_reserva_em=NOW() WHERE ultimo_item_id=$1',[item.id]).catch(()=>{});
  await evento(db,{loteId:item.lote_id,itemId:item.id,nivel:'erro',codigo:'ENTREGA_INCERTA',mensagem:erro,
    detalhes:{requer_conferencia:true}});
}
async function concluido(db,item,detalhes={}) {
  await atualizar(db,item,'concluido',{detalhes});
  await db.query('UPDATE marketing_publicacao_ritmo SET ultima_reserva_em=NOW() WHERE ultimo_item_id=$1',[item.id]).catch(()=>{});
  await evento(db,{loteId:item.lote_id,itemId:item.id,codigo:'PUBLICACAO_CONCLUIDA',mensagem:'Tarefa concluída.'});
}
async function processarFoto(db,item,lot) {
  for(const canal of CANAIS) await db.query(`INSERT INTO marketing_fila_canais(item_id,canal) VALUES($1,$2) ON CONFLICT DO NOTHING`,[item.id,canal]);
  const canais=(await db.query('SELECT * FROM marketing_fila_canais WHERE item_id=$1 ORDER BY canal',[item.id])).rows;
  if(canais.some(c=>c.estado==='enviando'||c.estado==='incerto')) {
    await incerto(db,item,'Há envio sem confirmação em pelo menos uma rede. Verifique antes de repetir.');return;
  }
  if(canais.every(c=>c.estado==='publicado')) { await concluido(db,item,{canais});return; }
  const canal=canais.find(c=>c.estado!=='publicado');
  if(!canal) return;
  // Validar produto ANTES de marcar que uma API externa pode ter sido acionada.
  let produto;
  try {produto=await status.buscarProdutoParaEnvio(item.produto_id,lot.categoria_id,'foto');}
  catch(e) {
    await db.query('UPDATE marketing_fila_itens SET tentativas=tentativas+1 WHERE id=$1',[item.id]);
    await retryOrAttention(db,{...item,tentativas:item.tentativas+1},`Não foi possível preparar a foto: ${cleanError(e)}`);
    return;
  }
  // Estado gravado ANTES da chamada: queda da instância torna o envio incerto, nunca duplicado às cegas.
  await db.query(`UPDATE marketing_fila_canais SET estado='enviando',tentativas=tentativas+1,erro=NULL,atualizado_em=NOW() WHERE item_id=$1 AND canal=$2`,[item.id,canal.canal]);
  await db.query(`UPDATE marketing_fila_itens SET estado='executando',tentativas=tentativas+1,atualizado_em=NOW() WHERE id=$1`,[item.id]);
  await evento(db,{loteId:item.lote_id,itemId:item.id,codigo:'ENVIO_INICIADO',mensagem:`Enviando foto para ${canal.canal}.`});
  try {
    let resultado;
    if(canal.canal==='whatsapp') resultado=await zap.enviarImagemStatus({imagem:produto.foto,legenda:`${produto.nome}\n${produto.preco_formatado}`});
    else if(canal.canal==='instagram') resultado=await status.publicarProdutoInstagram(produto,item.request_id);
    else resultado=await status.publicarProdutoFacebookStory(produto,item.request_id);
    // Guardar apenas identificadores retornados pelas plataformas, nunca tokens ou payloads.
    const referencias={confirmado:true,post_id:resultado?.post_id||null,photo_id:resultado?.photo_id||null,
      media_id:resultado?.media_id||null,container_id:resultado?.container_id||null,
      zapi_id:resultado?.zapi?.id||resultado?.id||null};
    await db.query(`UPDATE marketing_fila_canais SET estado='publicado',resultado=$3::jsonb,erro=NULL,atualizado_em=NOW()
                    WHERE item_id=$1 AND canal=$2`,[item.id,canal.canal,json(referencias)]);
    await evento(db,{loteId:item.lote_id,itemId:item.id,codigo:'CANAL_PUBLICADO',mensagem:`Publicação confirmada em ${canal.canal}.`});
    try {await termometro.registrarStatusZap({requestId:item.request_id,produto,canais:{[canal.canal]:{status:'publicado'}}});}
    catch(e) {await evento(db,{loteId:item.lote_id,itemId:item.id,nivel:'aviso',codigo:'TERMOMETRO',mensagem:cleanError(e)});}
  } catch(e) {
    // Falha após acionamento externo NÃO garante que o canal recusou a publicação.
    const erro=cleanError(e);
    await db.query(`UPDATE marketing_fila_canais SET estado='incerto',erro=$3,atualizado_em=NOW() WHERE item_id=$1 AND canal=$2`,[item.id,canal.canal,erro]);
    // Somente erros de configuração/validação ANTERIORES ao envio podem ser repetidos sem risco.
    if(/(?:não configurad[oa]|Configure:|ZAPI_URL|ZAPI_TOKEN|_GRAPH_BASE_URL|Imagem do Status é obrigatória|imagem inválida)/i.test(erro)) {
      await db.query("UPDATE marketing_fila_canais SET estado='pendente',erro=$3 WHERE item_id=$1 AND canal=$2",
        [item.id,canal.canal,erro]);
      await retryOrAttention(db,{...item,tentativas:Number(item.tentativas)+1},`${canal.canal}: ${erro}`,{codigo:'FALHA_ANTES_ENVIO'});
    } else {
      await incerto(db,item,`${canal.canal}: ${erro}. Conferir se foi publicado antes de reenviar.`);
    }
    return;
  }
  const restante=(await db.query("SELECT count(*)::integer AS n FROM marketing_fila_canais WHERE item_id=$1 AND estado<>'publicado'",[item.id])).rows[0].n;
  if(!restante) await concluido(db,item,{canais:CANAIS});
}
function temIncertoVideo(result) {
  return Object.values(result?.canais || {}).some(c => c.foto?.status==='incerto' || (c.partes||[]).some(p=>p.status==='incerto'));
}
async function processarVideo(db,item,lot) {
  const req=item.request_id;
  if(item.estado!=='aguardando_video') {
    let produto;
    try {produto=await status.buscarProdutoParaEnvio(item.produto_id,lot.categoria_id,lot.tipo_midia);}
    catch(e) {await db.query('UPDATE marketing_fila_itens SET tentativas=tentativas+1 WHERE id=$1',[item.id]);await retryOrAttention(db,{...item,tentativas:item.tentativas+1},`Preparação de vídeo: ${cleanError(e)}`);return;}
    await db.query("UPDATE marketing_fila_itens SET estado='aguardando_video',tentativas=tentativas+1,atualizado_em=NOW() WHERE id=$1",[item.id]);
    await evento(db,{loteId:item.lote_id,itemId:item.id,codigo:'VIDEO_INICIADO',mensagem:'Processamento de vídeo iniciado/retomado.',detalhes:{requestId:req}});
    try {await videos.iniciar({requestId:req,produto,tipoMidia:lot.tipo_midia});}
    catch(e) {await retryOrAttention(db,{...item,tentativas:item.tentativas+1},`Erro antes de iniciar vídeo: ${cleanError(e)}`);return;}
  }
  let result;
  try {result=await videos.consultar(req);} catch(e) {
    await retryOrAttention(db,{...item,tentativas:item.tentativas+1},`Consulta de vídeo: ${cleanError(e)}`);return;
  }
  const detalhes={progresso:result.progresso,resultado:result.status_geral, canais:result.canais,
    partes:result.total_partes,atualizado_em:new Date().toISOString()};
  if(result.status==='processando') {
    await atualizar(db,item,'aguardando_video',{detalhes});return;
  }
  if(result.status==='concluido' && result.status_geral==='publicado') {await concluido(db,item,detalhes);return;}
  const erro=cleanError(result.erro || Object.values(result.canais||{}).map(c=>c.erro).find(Boolean) || 'Vídeo incompleto');
  if(temIncertoVideo(result)) {await incerto(db,item,`Vídeo com envio incerto: ${erro}`,detalhes);return;}
  await retryOrAttention(db,item,`Vídeo ainda não concluído: ${erro}`,{detalhes});
}
async function processarFeed(db,item,lot) {
  await db.query("UPDATE marketing_fila_itens SET estado='executando',tentativas=tentativas+1,atualizado_em=NOW() WHERE id=$1",[item.id]);
  await evento(db,{loteId:item.lote_id,itemId:item.id,codigo:'FEED_INICIADO',mensagem:'Iniciando carrossel do Facebook.'});
  try {
    const result=await status.publicarCategoriaFacebook({requestId:item.request_id,categoriaId:lot.categoria_id});
    if(!result.success || result.status!=='publicado') throw new Error('Sem confirmação do carrossel.');
    await concluido(db,item,{posts:result.total_posts});
  } catch(e) {await incerto(db,item,`Carrossel: ${cleanError(e)}. Pode haver publicações parciais. Conferir o Facebook.`);}
}
async function fecharLotes(db) {
  const active=await db.query(`SELECT l.* FROM marketing_fila_lotes l WHERE l.estado IN ('pendente','executando')
    AND NOT EXISTS(SELECT 1 FROM marketing_fila_itens i WHERE i.lote_id=l.id AND i.estado <> ALL($1::text[]))
    ORDER BY l.id LIMIT 10`,[TERMINAIS]);
  for(const lote of active.rows) {
    // Concluir o lote e liberar o próximo horário são UMA transação: não pode ficar
    // marcado como concluído sem liberar o agendamento após uma queda no PostgreSQL.
    await db.query('BEGIN');
    try {
      const row=(await db.query('SELECT estado FROM marketing_fila_lotes WHERE id=$1 FOR UPDATE',[lote.id])).rows[0];
      if(!row || !['pendente','executando'].includes(row.estado)) {
        await db.query('COMMIT');continue;
      }
      const falhas=(await db.query("SELECT count(*)::integer AS n FROM marketing_fila_itens WHERE lote_id=$1 AND estado IN ('incerto','atencao')",[lote.id])).rows[0].n;
      const estado=falhas?'pendencias':'concluido';
      await db.query('UPDATE marketing_fila_lotes SET estado=$2,encerrado_em=NOW() WHERE id=$1',[lote.id,estado]);
      await evento(db,{loteId:lote.id,codigo:'LOTE_FINALIZADO',nivel:falhas?'aviso':'info',
        mensagem:falhas?`${falhas} tarefa(s) precisam de revisão; demais publicações continuarão.`:'Lote concluído.'});
      if(lote.origem.startsWith('statuszap')) {
        const cfg=(await db.query('SELECT * FROM status_agendamento_config WHERE id=1 FOR UPDATE')).rows[0];
        if(cfg && Number(cfg.lote_atual_id)===Number(lote.id)) {
          const agenda=require('../whatsapp/statusAgendamentos.service');
          const next=cfg.ativo?agenda.nextWindow(cfg,new Date(Date.now()+cfg.intervalo_minutos*60000)):null;
          const changed=Number(lote.metadados?.revisao ?? cfg.revisao)!==Number(cfg.revisao);
          await db.query('UPDATE status_agendamento_config SET lote_atual_id=NULL,indice=$2,proxima_execucao=$1 WHERE id=1',
            [next,changed?0:Number(cfg.indice)+1]);
        }
      }
      await db.query('COMMIT');
    } catch(e) {
      await db.query('ROLLBACK').catch(()=>{});
      throw e;
    }
  }
}

async function recuperarProcessos(db) {
  // Execuções com etapa de foto/feed interrompida nunca são reenviadas automaticamente.
  const r=await db.query(`SELECT i.*,l.tipo_midia FROM marketing_fila_itens i JOIN marketing_fila_lotes l ON l.id=i.lote_id
    WHERE i.estado='executando' ORDER BY i.id LIMIT 50`);
  for(const item of r.rows) {
    if(item.tipo==='statuszap_produto' && item.tipo_midia==='foto') {
      await db.query("UPDATE marketing_fila_canais SET estado='incerto',erro='Servidor reiniciou durante o envio',atualizado_em=NOW() WHERE item_id=$1 AND estado='enviando'",[item.id]);
      if((await db.query("SELECT 1 FROM marketing_fila_canais WHERE item_id=$1 AND estado='incerto' LIMIT 1",[item.id])).rows.length) {
        await incerto(db,item,'Render reiniciou durante o envio de foto. Conferir cada canal.');
      } else await atualizar(db,item,'pendente');
    } else if(item.tipo==='statuszap_feed' || item.tipo==='oferta_kit') {
      await incerto(db,item,'Render reiniciou durante um envio externo. Conferir redes antes de repetir.');
    } else {await atualizar(db,item,'aguardando_video');}
  }
}

function uuidEstavel(requestId){
  const h=crypto.createHash('sha256').update(requestId).digest('hex');
  return [h.slice(0,8),h.slice(8,12),h.slice(12,16),h.slice(16,20),h.slice(20,32)].join('-');
}
async function processarYoutube(db,item){
  const republicador=require('./republicador-youtube.service');
  const videoId=item.detalhes?.youtube_video_id||item.request_id.replace(/^youtube-auto-/,'');
  const jobId=item.detalhes?.job_id||uuidEstavel(item.request_id);
  if(!/^[A-Za-z0-9_-]{11}$/.test(videoId))throw new Error('Vídeo inválido na fila do YouTube.');
  const job=await republicador.obter(jobId);
  if(!job){
    // UUID estável: reinicialização antes/depois da criação não duplica job.
    await atualizar(db,item,'aguardando_video',{detalhes:{...item.detalhes,job_id:jobId}});
    const criado=await republicador.iniciar(videoId,'publicar',jobId);
    if(criado.id!==jobId)await atualizar(db,item,'aguardando_video',
      {detalhes:{...item.detalhes,job_id:criado.id}});
    return;
  }
  if(job.estado==='concluido'){
    await concluido(db,item,{...item.detalhes,job_id:job.id,concluido_em:new Date().toISOString()});return;
  }
  if(['parcial','erro','interrompido'].includes(job.estado)){
    await incerto(db,item,'Republicador sem confirmação completa das três redes. Conferir histórico antes de repetir.',
      {...item.detalhes,job_id:job.id,estado_republicador:job.estado});return;
  }
  await atualizar(db,item,'aguardando_video',{detalhes:{...item.detalhes,job_id:job.id,estado_republicador:job.estado}});
}
async function processarOferta(db,item){
  const ofertas=require('../ofertas/ofertas.service');
  // Grava "executando" antes da chamada que pode publicar nos quatro canais.
  await atualizar(db,item,'executando',{detalhes:item.detalhes});
  const base=process.env.PUBLIC_BASE_URL||'https://catalogo-aluminio-jr.onrender.com';
  let result;
  try{result=await ofertas.publicar(item.produto_id,base);}
  catch(e){await incerto(db,item,'Kit com resultado desconhecido: '+cleanError(e)+'. Conferir quatro redes.');return;}
  if(result.publicacao_completa===true){
    await concluido(db,item,{...item.detalhes,oferta_id:item.produto_id,canais:result.canais});return;
  }
  if(result.publicacao_parcial===true){
    await incerto(db,item,'Kit publicado parcialmente. Conferir WhatsApp, Instagram e Facebook.',
      {...item.detalhes,canais:result.canais});return;
  }
  await atualizar(db,item,'atencao',{erro:'Kit requer confirmação manual da regra de repetição antes de publicar.',
    detalhes:{...item.detalhes,comparacao_pendente:true}});
  await evento(db,{loteId:item.lote_id,itemId:item.id,nivel:'aviso',codigo:'KIT_REQUER_CONFIRMACAO',
    mensagem:'Kit precisa de confirmação no aplicativo Central de Ofertas.'});
}
async function respeitarRitmo(db,item){
  // O limite é por tarefa (vídeo ou kit), não por rede nem trecho da mesma tarefa.
  if(!['pendente','aguardando_retry'].includes(item.estado))return true;
  const r=(await db.query('SELECT * FROM marketing_publicacao_ritmo WHERE id=1 FOR UPDATE')).rows[0];
  if(!r)return false;
  if(Number(r.ultimo_item_id)===Number(item.id))return true;
  const next=r.ultima_reserva_em?new Date(r.ultima_reserva_em).getTime()+
    r.intervalo_global_minutos*60000:0;
  if(next>Date.now())return false;
  await db.query('UPDATE marketing_publicacao_ritmo SET ultimo_item_id=$1,ultima_reserva_em=NOW() WHERE id=1',[item.id]);
  return true;
}

async function executarPasso() {
  if(busy) return;busy=true;let db,locked=false;
  try {
    await table();await require('./agendadorModulos.service').schema();db=await pool.connect();
    locked=(await db.query('SELECT pg_try_advisory_lock($1) AS ok',[LOCK])).rows[0].ok;
    if(!locked) return;
    await recuperarProcessos(db);
    await fecharLotes(db);
    const r=await db.query(`SELECT i.*,l.origem,l.categoria_id,l.tipo_midia,l.categoria_nome FROM marketing_fila_itens i
      JOIN marketing_fila_lotes l ON l.id=i.lote_id
      WHERE l.estado IN ('pendente','executando') AND i.estado <> ALL($1::text[])
        AND (l.origem NOT IN ('youtube_agenda','ofertas_agenda') OR EXISTS(
          SELECT 1 FROM marketing_agendadores_modulos mc
          WHERE mc.modulo=CASE WHEN l.origem='youtube_agenda' THEN 'youtube' ELSE 'ofertas' END
          AND mc.ativo=TRUE))
      ORDER BY l.id,i.ordem LIMIT 1`,[TERMINAIS]);
    if(!r.rows.length) return;
    const item=r.rows[0];
    // Somente as tarefas do agendamento do Status Zap obedecem ao interruptor desse agendamento.
    if(item.origem.startsWith('statuszap')) {
      const cfg=(await db.query('SELECT ativo FROM status_agendamento_config WHERE id=1')).rows[0];
      if(!cfg?.ativo) return;
    }
    if(item.origem==='youtube_agenda'||item.origem==='ofertas_agenda'){
      const modulo=item.origem==='youtube_agenda'?'youtube':'ofertas';
      const c=(await db.query('SELECT ativo FROM marketing_agendadores_modulos WHERE modulo=$1',[modulo])).rows[0];
      if(!c?.ativo)return;
    }
    if(item.proxima_tentativa && new Date(item.proxima_tentativa)>new Date()) return;
    if(!await respeitarRitmo(db,item))return;
    const lot={categoria_id:item.categoria_id,tipo_midia:item.tipo_midia};
    if(item.tipo==='youtube_video') await processarYoutube(db,item);
    else if(item.tipo==='oferta_kit') await processarOferta(db,item);
    else if(item.tipo==='statuszap_feed') await processarFeed(db,item,lot);
    else if(item.tipo==='statuszap_produto' && item.tipo_midia==='foto') await processarFoto(db,item,lot);
    else if(item.tipo==='statuszap_produto') await processarVideo(db,item,lot);
    else await incerto(db,item,'Tipo de tarefa não suportado pelo funil.');
    await fecharLotes(db);
  } catch(e) {console.error('[Funil publicações]',cleanError(e));}
  finally {if(db){if(locked)await db.query('SELECT pg_advisory_unlock($1)',[LOCK]).catch(()=>{});db.release();}busy=false;}
}
async function painel() {
  await table();
  const [stats,items,logs,lotes] = await Promise.all([
    pool.query(`SELECT COUNT(*) FILTER(WHERE estado IN ('pendente','executando','aguardando_video','aguardando_retry'))::int AS pendentes,
      COUNT(*) FILTER(WHERE estado IN ('executando','aguardando_video'))::int AS em_execucao,
      COUNT(*) FILTER(WHERE estado='concluido')::int AS concluidas,
      COUNT(*) FILTER(WHERE estado IN ('incerto','atencao'))::int AS atencao FROM marketing_fila_itens`),
    pool.query(`SELECT i.id,i.lote_id,i.ordem,i.tipo,i.produto_id,i.produto_nome,i.estado,i.erro,i.tentativas,
      i.proxima_tentativa,i.detalhes,l.categoria_nome,l.tipo_midia,l.origem,l.criado_em
      FROM marketing_fila_itens i JOIN marketing_fila_lotes l ON l.id=i.lote_id
      WHERE i.estado IN ('incerto','atencao','aguardando_video','aguardando_retry','executando') ORDER BY i.id DESC LIMIT 60`),
    pool.query(`SELECT e.id,e.criado_em,e.nivel,e.codigo,e.mensagem,e.item_id,e.lote_id,
      l.categoria_nome,i.produto_nome FROM marketing_fila_eventos e
      LEFT JOIN marketing_fila_lotes l ON l.id=e.lote_id
      LEFT JOIN marketing_fila_itens i ON i.id=e.item_id ORDER BY e.id DESC LIMIT 100`),
    pool.query('SELECT id,origem,categoria_id,categoria_nome,tipo_midia,estado,criado_em,encerrado_em FROM marketing_fila_lotes ORDER BY id DESC LIMIT 25')
  ]);
  return {resumo:stats.rows[0],itens:items.rows,logs:logs.rows,lotes:lotes.rows};
}
async function buscarLogs({nivel='',de='',ate='',antes='',limite=100}={}) {
  await table();
  const limit=Math.max(1,Math.min(200,Number(limite)||100));
  const filtro=['1=1'],args=[];
  function bind(v){args.push(v);return '$'+args.length;}
  if(nivel) {
    if(!['info','erro','aviso'].includes(nivel))throw new Error('Filtro de nível inválido.');
    filtro.push(`e.nivel=${bind(nivel)}`);
  }
  for(const [valor,campo,op] of [[de,'e.criado_em','>='],[ate,'e.criado_em','<']]){
    if(valor){const d=new Date(valor);
      if(!Number.isFinite(d.getTime()))throw new Error('Data inválida.');
      filtro.push(`${campo} ${op} ${bind(d.toISOString())}`);
    }
  }
  if(antes){if(!Number.isSafeInteger(Number(antes))||Number(antes)<=0)throw new Error('Cursor inválido.');
    filtro.push(`e.id < ${bind(Number(antes))}`);}
  const r=await pool.query(`SELECT e.id,e.criado_em,e.nivel,e.codigo,e.mensagem,e.item_id,e.lote_id,e.detalhes,
     l.categoria_nome,l.origem,i.produto_nome FROM marketing_fila_eventos e
     LEFT JOIN marketing_fila_lotes l ON l.id=e.lote_id
     LEFT JOIN marketing_fila_itens i ON i.id=e.item_id
     WHERE ${filtro.join(' AND ')} ORDER BY e.id DESC LIMIT ${bind(limit)}`,args);
  return {logs:r.rows,proximo_cursor:r.rows.length===limit?r.rows[r.rows.length-1].id:null};
}
async function detalheItem(id) {
  await table();const item=(await pool.query('SELECT * FROM marketing_fila_itens WHERE id=$1',[id])).rows[0];
  if(!item)return null;
  const canais=(await pool.query('SELECT * FROM marketing_fila_canais WHERE item_id=$1 ORDER BY canal',[id])).rows;
  return {item,canais};
}
async function resolverItem({id,acao,canal=null}) {
  await table();if(!Number.isSafeInteger(Number(id))||Number(id)<=0)throw new Error('Item inválido.');
  if(!['confirmar_publicado','confirmar_nao_publicado'].includes(acao))throw new Error('Ação inválida.');
  const db=await pool.connect();let locked=false;
  try {
    locked=(await db.query('SELECT pg_try_advisory_lock($1) AS ok',[LOCK])).rows[0].ok;
    if(!locked)throw new Error('Há publicação em andamento. Tente novamente daqui a pouco.');
    await db.query('BEGIN');
    const item=(await db.query('SELECT * FROM marketing_fila_itens WHERE id=$1 FOR UPDATE',[Number(id)])).rows[0];
    if(!item || !['incerto','atencao'].includes(item.estado))throw new Error('Somente tarefas com pendência podem ser conciliadas.');
    const lot=(await db.query('SELECT * FROM marketing_fila_lotes WHERE id=$1',[item.lote_id])).rows[0];
    if(lot.tipo_midia==='foto' && item.tipo==='statuszap_produto') {
      const vals=(await db.query("SELECT * FROM marketing_fila_canais WHERE item_id=$1 AND estado='incerto'",[item.id])).rows;
      if(!vals.length && item.estado==='atencao' && acao==='confirmar_nao_publicado') {
        await atualizar(db,item,'pendente');
        await db.query('UPDATE marketing_fila_itens SET tentativas=0 WHERE id=$1',[item.id]);
      } else {
      if(!vals.length)throw new Error('Nenhuma rede marcada como incerta. Consulte o histórico.');
      if(!canal && vals.length>1)throw new Error('Selecione a rede social que foi conferida.');
      const alvo=canal || vals[0].canal;
      if(!vals.some(x=>x.canal===alvo))throw new Error('Essa rede social não tem envio incerto.');
      await db.query('UPDATE marketing_fila_canais SET estado=$3,erro=NULL,atualizado_em=NOW() WHERE item_id=$1 AND canal=$2',
        [item.id,alvo,acao==='confirmar_publicado'?'publicado':'pendente']);
      const restantes=(await db.query("SELECT count(*)::int AS n FROM marketing_fila_canais WHERE item_id=$1 AND estado='incerto'",[item.id])).rows[0].n;
      const outros=(await db.query("SELECT count(*)::int AS n FROM marketing_fila_canais WHERE item_id=$1 AND estado<>'publicado'",[item.id])).rows[0].n;
      await atualizar(db,item,restantes?'incerto':outros?'pendente':'concluido');
      if(!restantes && acao==='confirmar_nao_publicado')
        await db.query('UPDATE marketing_fila_itens SET tentativas=0 WHERE id=$1',[item.id]);
      }
    } else if(item.tipo==='youtube_video'){
      const republicador=require('./republicador-youtube.service');
      const jobId=item.detalhes?.job_id;
      if(acao==='confirmar_publicado'){
        await atualizar(db,item,'concluido',{detalhes:{...item.detalhes,confirmacao_manual:true}});
      }else{
        if(jobId){
          const job=await republicador.obter(jobId);
          if(job && ['parcial','erro','interrompido'].includes(job.estado))await republicador.retry(jobId);
        }
        await atualizar(db,item,'aguardando_video',{detalhes:item.detalhes});
      }
    } else if(item.tipo==='oferta_kit'){
      if(acao==='confirmar_publicado'){
        await atualizar(db,item,'concluido',{detalhes:{...item.detalhes,confirmacao_manual:true}});
      }else{
        const of=(await db.query('SELECT whatsapp_status,instagram_status,facebook_story_status,facebook_feed_status FROM ofertas WHERE id=$1',[item.produto_id])).rows[0];
        if(of && ['whatsapp_status','instagram_status','facebook_story_status','facebook_feed_status'].some(k=>of[k]==='publicado'))
          throw new Error('Já existe canal confirmado. Não é seguro reenviar o kit inteiro. Concilie manualmente.');
        await atualizar(db,item,'pendente',{detalhes:item.detalhes});
      }
    } else if(item.tipo==='statuszap_produto' && ['video','foto_video'].includes(lot.tipo_midia)) {
      if(item.estado==='incerto') {
        // A ação explícita afeta apenas as partes marcadas incertas, nunca as já publicadas.
        const resultado=await videos.reconciliarIncerto(item.request_id,
           acao==='confirmar_publicado'?'publicado':'nao_publicado',db);
        await atualizar(db,item,resultado.concluido?'concluido':'pendente');
      } else if(acao==='confirmar_nao_publicado') {
        await atualizar(db,item,'pendente');
        await db.query('UPDATE marketing_fila_itens SET tentativas=0 WHERE id=$1',[item.id]);
      } else throw new Error('Só é possível confirmar um vídeo completo após conciliar suas partes incertas.');
    } else {
      if(acao==='confirmar_nao_publicado') {
        await atualizar(db,item,'pendente');
        await db.query('UPDATE marketing_fila_itens SET tentativas=0 WHERE id=$1',[item.id]);
      } else await atualizar(db,item,'concluido',{detalhes:{confirmacao_manual:true}});
    }
    const estadoFinal=(await db.query('SELECT estado FROM marketing_fila_itens WHERE id=$1',[item.id])).rows[0].estado;
    if(['pendente','aguardando_retry'].includes(estadoFinal)) {
      await db.query("UPDATE marketing_fila_lotes SET estado='pendente',encerrado_em=NULL WHERE id=$1",[item.lote_id]);
    }
    await evento(db,{loteId:item.lote_id,itemId:item.id,nivel:'aviso',codigo:'CONCILIACAO_MANUAL',mensagem:`Operador: ${acao}${canal?' ('+canal+')':''}.`});
    await db.query('COMMIT');
    return {success:true};
  }catch(e){await db.query('ROLLBACK').catch(()=>{});throw e;}
  finally {if(locked)await db.query('SELECT pg_advisory_unlock($1)',[LOCK]).catch(()=>{});db.release();}
}
function start() {
  if(started)return;started=true;
  const timer=setInterval(()=>executarPasso().catch(e=>console.error('[Funil]',cleanError(e))),12000);
  timer.unref?.();setTimeout(()=>executarPasso().catch(e=>console.error('[Funil]',cleanError(e))),8000).unref?.();
}
module.exports={table,enfileirarLote,event: evento,painel,buscarLogs,detalheItem,resolverItem,executarPasso,start};
