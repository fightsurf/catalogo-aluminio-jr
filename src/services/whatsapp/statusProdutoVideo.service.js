const pool = require('../../../db/connection');
const fs = require('fs/promises');
const media = require('./statusProdutoVideoMedia.service');
const r2 = require('../cloudflare/cloudflareR2.service');
const zap = require('../integracoes/zapi.service');
const instagram = require('../integracoes/instagram.service');
const facebook = require('../integracoes/facebook.service');
const termometro = require('../termometro/termometroAparicoes.service');
function mensagemErro(e) { return String(e?.message || e).replace(/https?:\/\/[^\s)]+/gi, '[endereço omitido]').slice(0,1500); }
const CANAIS = ['whatsapp','instagram','facebook_story'];
const ativos = new Set();
let fila = Promise.resolve();
let schema;
function estrutura() {
  if (!schema) schema = pool.query(`CREATE TABLE IF NOT EXISTS status_produto_video_jobs (
    request_id TEXT PRIMARY KEY, produto_id INTEGER NOT NULL,
    dados JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`).catch(e=>{schema=null;throw e;});
  return schema;
}
function validarId(id) {
  if (!/^[a-zA-Z0-9._:-]{1,120}$/.test(String(id || ''))) throw new Error('Identificador do envio inválido.');
  return String(id);
}
function resumo(job) {
  const canais = {};
  for(const canal of CANAIS) {
    const partes = (job.partes || []).map(p=>({ numero:p.numero, ...p.canais[canal] }));
    const publicados = partes.filter(p=>p.status==='publicado').length;
    const foto = job.fotos?.[canal];
    const fotoOk = !foto || foto.status === 'publicado';
    const falha = (foto && !fotoOk ? foto : null) || partes.find(p=>['erro','incerto'].includes(p.status));
    canais[canal] = {
      status: (partes.length || foto) && publicados===partes.length && fotoOk ? 'publicado' : (publicados || foto?.status==='publicado') ? 'parcial' : 'erro',
      foto: foto || null,
      partes_publicadas:publicados,total_partes:partes.length,partes,
      erro:falha?.erro || job.erro || (publicados<partes.length ? 'Há partes pendentes.' : '')
    };
  }
  const completos = CANAIS.filter(c=>canais[c].status==='publicado').length;
  const algum = CANAIS.some(c=>canais[c].partes_publicadas>0 || canais[c].foto?.status==='publicado');
  return {
    requestId:job.requestId, produto:job.produto, tipoMidia:job.tipoMidia || 'video',
    status:job.status, progresso:job.progresso || '', erro:job.erro || '',
    status_geral:completos===3?'publicado':algum?'parcial':'erro',
    canais, total_partes:job.partes?.length || 0, duracao_original:job.duracao_original,
    repetida:job.repetida || false
  };
}
async function ler(id, db=pool) {
  const r = await db.query('SELECT dados FROM status_produto_video_jobs WHERE request_id=$1',[id]);
  if (!r.rows.length) throw new Error('Publicação de vídeo não encontrada.');
  return r.rows[0].dados;
}
async function salvar(job, db) {
  await db.query('UPDATE status_produto_video_jobs SET dados=$2::jsonb, updated_at=NOW() WHERE request_id=$1',[job.requestId,JSON.stringify(job)]);
}
function agendar(id) {
  if (ativos.has(id)) return;
  ativos.add(id);
  fila = fila.catch(()=>{}).then(()=>processar(id)).catch(e=>console.error('[Status vídeo]', e.message)).finally(()=>ativos.delete(id));
}
async function iniciar({requestId,produto,tipoMidia='video'}) {
  await estrutura();const id=validarId(requestId);
  const job={ requestId:id,produto,tipoMidia,fotos:tipoMidia==='foto_video' && produto.publicavel_foto ? Object.fromEntries(CANAIS.map(c=>[c,{status:'pendente'}])) : null,status:'processando',progresso:'Vídeo na fila de preparação.',partes:[] };
  await pool.query('INSERT INTO status_produto_video_jobs (request_id,produto_id,dados) VALUES ($1,$2,$3::jsonb) ON CONFLICT DO NOTHING',[id,produto.id,JSON.stringify(job)]);
  const atual=await ler(id);
  if ((atual.tipoMidia || 'video')!==tipoMidia) throw new Error('Identificador já usado por outro modo de publicação.');
  if (Number(atual.produto.id)!==Number(produto.id) || Number(atual.produto.categoria_id)!==Number(produto.categoria_id)) throw new Error('Identificador já usado por outro produto/categoria.');
  if (atual.status!=='concluido') {
    await pool.query(`UPDATE status_produto_video_jobs SET dados=jsonb_set(dados,'{status}','"processando"'::jsonb), updated_at=NOW() WHERE request_id=$1 AND dados->>'status'='erro'`,[id]);
    agendar(id);
  }
  return { ...resumo(atual), status:atual.status==='concluido'?'concluido':'processando' };
}
async function consultar(id) {
  await estrutura();validarId(id);const job=await ler(id);
  // Depois de reiniciar o servidor, a consulta retoma a preparação. Partes em
  // envio sem confirmação são sinalizadas; não são republicadas automaticamente.
  if (job.status==='processando') agendar(id);
  return resumo(job);
}
async function processar(id) {
  const db=await pool.connect();let lock=false,job,contexto;
  try {
    const r=await db.query('SELECT pg_try_advisory_lock(9172046, hashtext($1)) AS locked',[id]);
    lock=r.rows[0].locked;if(!lock)return;
    job=await ler(id,db);if(job.status==='concluido')return;
    for(const p of job.partes) for(const canal of CANAIS) if(p.canais[canal].status==='enviando') {
      p.canais[canal]={status:'incerto',erro:'O servidor reiniciou durante o envio. Confira esta parte na rede antes de iniciar outra publicação.'};
    }
    for(const canal of CANAIS) if(job.fotos?.[canal]?.status==='enviando') job.fotos[canal]={status:'incerto',erro:'Envio da foto interrompido sem confirmação. Confira a rede antes de publicar novamente.'};
    job.status='processando';job.erro='';await salvar(job,db);
    const precisaArquivo=Boolean(job.produto.video_url) && (!job.partes.length || job.partes.some(p=>!p.url));
    if(precisaArquivo) {
      job.progresso='Baixando e analisando o vídeo completo.';await salvar(job,db);
      contexto=await media.preparar(job.produto);
      if(!job.partes.length) {
        job.duracao_original=contexto.duracao;
        job.partes=contexto.partes.map(p=>({...p,canais:Object.fromEntries(CANAIS.map(c=>[c,{status:'pendente'}]))}));
        await salvar(job,db);
      } else if(Math.abs(contexto.duracao-job.duracao_original)>0.1) throw new Error('O arquivo original mudou de duração. Inicie uma nova publicação.');
    }
    // Prepara todas as partes antes de publicar. Nenhuma parte final é descartada.
    for(const p of job.partes) if(!p.url) {
      job.progresso=`Preparando parte ${p.numero} de ${job.partes.length}.`;await salvar(job,db);
      const arquivo=await media.gerar(contexto,job.produto,p,job.partes.length);
      try {
        const upload=await r2.uploadArquivoLocal(arquivo.caminho,{pasta:'status-videos',nome:`produto-${job.produto.id}-${id}-${p.numero}.mp4`,contentType:'video/mp4'});
        p.url=upload.url;p.r2_key=upload.key;p.tamanho_bytes=arquivo.tamanho_bytes;p.duracao_final=arquivo.duracao;
        await salvar(job,db);
      } finally { await fs.unlink(arquivo.caminho).catch(()=>{}); }
    }
    if(contexto) {await fs.rm(contexto.pasta,{recursive:true,force:true});contexto=null;}
    // A ordem é sequencial em cada canal. Uma falha pausa aquele canal antes
    // da parte seguinte; as outras redes ainda recebem a sequência completa.
    for(const canal of CANAIS) {
      if (job.fotos?.[canal] && job.fotos[canal].status !== 'publicado') {
        if (job.fotos[canal].status === 'incerto') continue;
        job.progresso=`${canal}: publicando a foto antes do vídeo.`;
        job.fotos[canal]={status:'enviando'};await salvar(job,db);
        try {
          const fotos=require('./status-whatsapp.service');
          let resultado;
          if(canal==='whatsapp') resultado=await zap.enviarImagemStatus({imagem:job.produto.foto,legenda:`${job.produto.nome}\n${job.produto.preco_formatado}`});
          else if(canal==='instagram') resultado=await fotos.publicarProdutoInstagram(job.produto,`${id}-foto`);
          else resultado=await fotos.publicarProdutoFacebookStory(job.produto,`${id}-foto`);
          job.fotos[canal]={status:'publicado',resultado};
        }catch(e){
          const incerto=/falha ao conectar|fetch failed|ECONN|socket|aborted/i.test(String(e.message||e));
          job.fotos[canal]={status:incerto?'incerto':'erro',erro:mensagemErro(e)};
          await salvar(job,db);continue;
        }
        await salvar(job,db);
        try { await termometro.registrarStatusZap({requestId:`video:${id}`,produto:job.produto,canais:{[canal]:{status:'publicado'}}}); }
        catch(e){console.error('[Status foto/vídeo] Contador:',e.message);}
      }
      for(const p of job.partes) {
        if(p.canais[canal].status==='publicado')continue;
        if(p.canais[canal].status==='incerto')break;
        job.progresso=`${canal}: publicando parte ${p.numero} de ${job.partes.length}.`;
        p.canais[canal]={status:'enviando'};await salvar(job,db);
        try {
          let resultado;
          if(canal==='whatsapp') resultado=await zap.enviarVideoStatus({video:p.url,legenda:`${job.produto.nome}\n${job.produto.preco_formatado}\nParte ${p.numero}/${job.partes.length}`});
          else if(canal==='instagram')resultado=await instagram.publicarStoryVideo({videoUrl:p.url});
          else resultado=await facebook.publicarStoryVideo({videoUrl:p.url});
          p.canais[canal]={status:'publicado',resultado};
        } catch(e) {
          const incerto = /falha ao conectar|fetch failed|ECONN|socket|aborted/i.test(String(e.message || e));
          p.canais[canal]={status:incerto?'incerto':'erro',erro:mensagemErro(e) + (incerto ? ' Confira esta parte na rede: não houve confirmação do resultado e ela não será reenviada automaticamente.' : '')};
          await salvar(job,db);break;
        }
        await salvar(job,db);
        try {
          await termometro.registrarStatusZap({requestId:`video:${id}`,produto:job.produto,canais:{[canal]:{status:'publicado'}}});
        }catch(e){console.error('[Status vídeo] Contador de aparições:',e.message);}
      }
    }
    const completo=(!job.fotos || CANAIS.every(c=>job.fotos[c].status==='publicado')) && job.partes.every(p=>CANAIS.every(c=>p.canais[c].status==='publicado'));
    job.status=completo?'concluido':'erro';
    job.progresso=completo?`Publicação concluída: ${job.fotos ? 'foto e ' : ''}${job.partes.length} parte(s) de vídeo em cada rede.`:'Publicação com falhas. O reenvio retoma as partes pendentes.';
    await salvar(job,db);
  }catch(e){
    if(job){job.status='erro';job.erro=mensagemErro(e);job.progresso=job.erro;await salvar(job,db).catch(()=>{});}
    else throw e;
  }finally{
    if(contexto)await fs.rm(contexto.pasta,{recursive:true,force:true}).catch(()=>{});
    if(lock)await db.query('SELECT pg_advisory_unlock(9172046, hashtext($1))',[id]).catch(()=>{});
    db.release();
  }
}
module.exports={iniciar,consultar,resumo};
