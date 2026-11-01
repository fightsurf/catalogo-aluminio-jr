'use strict';
const express=require('express'),path=require('node:path');
const pool=require('../../../db/connection');
const {requireAuth}=require('../../middlewares/adminAuth.middleware');
const status=require('../../services/whatsapp/status-whatsapp.service');
const statusAgenda=require('../../services/whatsapp/statusAgendamentos.service');
const agenda=require('../../services/marketing/agendadorModulos.service');
const funil=require('../../services/marketing/funilPublicacoes.service');
const router=express.Router();
router.use(requireAuth);
const wrap=fn=>async(req,res)=>{try{res.json({success:true,data:await fn(req,res)});}
  catch(e){res.status(400).json({success:false,message:String(e.message||e).slice(0,400)});}};
router.get('/',(_req,res)=>res.sendFile(path.resolve(__dirname,'../../../views/marketing/central-publicacoes.html')));
router.get('/api/painel',wrap(async()=>{
  const [statusCfg,youtube,ofertas,fila]=await Promise.all([
    statusAgenda.obter(),agenda.obter('youtube'),agenda.obter('ofertas'),funil.painel()]);
  await agenda.schema();
  const ritmo=(await pool.query('SELECT * FROM marketing_publicacao_ritmo WHERE id=1')).rows[0];
  return {status:statusCfg,youtube,ofertas,fila,ritmo};
}));
router.get('/api/logs',wrap(req=>funil.buscarLogs(req.query||{})));
router.get('/api/itens/:id',wrap(req=>funil.detalheItem(req.params.id)));
router.post('/api/itens/:id/conciliar',wrap(req=>funil.resolverItem({id:req.params.id,...req.body})));
router.post('/api/recuperar-legado/:id',wrap(req=>statusAgenda.migrarLegado(req.params.id)));
router.put('/api/status',wrap(req=>statusAgenda.salvar(req.body||{})));
router.put('/api/youtube',wrap(req=>agenda.salvar('youtube',req.body||{})));
router.put('/api/ofertas',wrap(req=>agenda.salvar('ofertas',req.body||{})));
router.put('/api/global',wrap(async req=>{
  await agenda.schema();
  const g=Number(req.body?.intervalo_global_minutos),p=req.body?.prioridades;
  if(!Number.isSafeInteger(g)||g<1||g>1440)throw Error('Pausa global deve estar entre 1 e 1440 minutos.');
  if(!p||typeof p!=='object'||Array.isArray(p)||
    !['statuszap','youtube','ofertas'].every(x=>Number.isInteger(p[x]))||
    Object.keys(p).length!==3||
    [p.statuszap,p.youtube,p.ofertas].sort((a,b)=>a-b).join(',')!=='1,2,3')
    throw Error('Defina prioridades distintas de 1 a 3.');
  const r=await pool.query(`UPDATE marketing_publicacao_ritmo
    SET intervalo_global_minutos=$1,pausado=$2,prioridades=$3::jsonb,atualizado_em=NOW()
    WHERE id=1 RETURNING *`,[g,req.body?.pausado===true,JSON.stringify(p)]);
  return r.rows[0];
}));
function uniqueKey(req){const k=String(req.body?.solicitacao_id||'');
  if(!/^[0-9a-f]{8}-[0-9a-f-]{27,36}$/i.test(k))throw Error('Identificador de solicitação inválido.');
  return k;
}
router.post('/api/manual/status',wrap(async req=>{
  const key=uniqueKey(req),cat=Number(req.body?.categoria_id),tipo=String(req.body?.tipo_midia||'');
  const ids=req.body?.produtos;
  if(!Number.isSafeInteger(cat)||cat<=0||!['foto','video','foto_video'].includes(tipo)||
    !Array.isArray(ids)||!ids.length||ids.length>300||
    ids.some(x=>!Number.isSafeInteger(x)||x<=0)||new Set(ids).size!==ids.length)
      throw Error('Categoria, tipo ou produtos inválidos.');
  await funil.table();
  const pend=await pool.query(`SELECT 1 FROM marketing_fila_itens i
    JOIN marketing_fila_lotes l ON l.id=i.lote_id
    WHERE l.origem='statuszap_manual' AND l.categoria_id=$1
    AND l.tipo_midia=$2 AND i.estado IN ('pendente','executando','aguardando_retry','aguardando_video','incerto','atencao')
    LIMIT 1`,[cat,tipo]);
  if(pend.rowCount)throw Error('Esta categoria já tem publicação manual pendente. Consulte a Central.');
  const listing=await status.listarProdutosPorCategoria(cat);
  const found=new Map(listing.produtos.map(x=>[Number(x.id),x]));
  const itens=ids.map(id=>{
    const produto=found.get(id);
    if(!produto)throw Error('Produto fora da categoria.');
    const ok=tipo==='foto'?produto.publicavel_foto:tipo==='video'?produto.publicavel_video:
      produto.publicavel_foto||produto.publicavel_video;
    if(!ok)throw Error('Produto indisponível: '+produto.nome);
    return {tipo:'statuszap_produto',produtoId:id,produtoNome:produto.nome,requestId:'status-manual-'+key+'-'+id};
  });
  if(tipo==='foto')itens.push({tipo:'statuszap_feed',produtoNome:'Carrossel Facebook',
    requestId:'status-manual-'+key+'-feed'});
  return funil.enfileirarLote({origem:'statuszap_manual',chaveOrigem:'statuszap:manual:'+key,
    categoriaId:cat,categoriaNome:listing.categoria.nome,tipoMidia:tipo,itens,metadados:{manual:true}});
}));
router.post('/api/manual/youtube',wrap(async req=>{
  const key=uniqueKey(req),id=String(req.body?.video_id||'');
  if(!/^[A-Za-z0-9_-]{11}$/.test(id)||req.body?.confirmar!=='PUBLICAR_NAS_TRES_REDES')
    throw Error('Vídeo ou confirmação inválidos.');
  await funil.table();
  const exists=await pool.query(`SELECT 1 FROM marketing_fila_itens i
    WHERE i.tipo='youtube_video' AND i.detalhes->>'youtube_video_id'=$1 AND i.estado<>'ignorado' LIMIT 1`,[id]);
  if(exists.rowCount)throw Error('Este vídeo já foi incluído no funil. Confira o histórico antes de repetir.');
  return funil.enfileirarLote({origem:'youtube_manual',chaveOrigem:'youtube:manual:'+key,
    categoriaNome:'YouTube',tipoMidia:'video',itens:[{tipo:'youtube_video',
      produtoNome:String(req.body?.titulo||id).slice(0,180),requestId:'youtube-manual-'+key,
      detalhes:{youtube_video_id:id}}],metadados:{manual:true}});
}));
router.post('/api/manual/ofertas',wrap(async req=>{
  const key=uniqueKey(req),id=Number(req.body?.oferta_id);
  if(!Number.isSafeInteger(id)||id<=0||req.body?.confirmar!=='PUBLICAR_KIT')
    throw Error('Kit ou confirmação inválidos.');
  const r=await pool.query(`SELECT id,titulo,whatsapp_status,instagram_status,facebook_story_status,facebook_feed_status
    FROM ofertas WHERE id=$1`,[id]);
  if(!r.rows.length)throw Error('Kit não encontrado.');
  const oferta=r.rows[0];
  if(['whatsapp_status','instagram_status','facebook_story_status','facebook_feed_status']
    .some(x=>oferta[x]&&oferta[x]!=='nao_publicado'))
    throw Error('Kit com publicação anterior: confira no histórico antes de repetir.');
  await funil.table();
  const exists=await pool.query(`SELECT 1 FROM marketing_fila_itens
    WHERE tipo='oferta_kit' AND produto_id=$1 AND estado<>'ignorado' LIMIT 1`,[id]);
  if(exists.rowCount)throw Error('Este kit já está ou esteve no funil. Confira o histórico.');
  return funil.enfileirarLote({origem:'ofertas_manual',chaveOrigem:'ofertas:manual:'+key,
    categoriaNome:'Kit Feirinha',tipoMidia:'foto',itens:[{tipo:'oferta_kit',
      produtoId:id,produtoNome:oferta.titulo,requestId:'ofertas-manual-'+key}],
    metadados:{manual:true}});
}));
module.exports=router;
