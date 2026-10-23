'use strict';
// Configuração única, persistente, das notificações de fases da matriz de progresso.
// Textos migrados uma vez para o PostgreSQL (não são sobrescritos por deploys futuros).
const pool = require('../../../../db/connection');
const { randomUUID } = require('crypto');
const { spawn } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs/promises');
const { S3Client, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const r2 = require('../../cloudflare/cloudflareR2.service');
const eleven = require('../../integracoes/elevenlabs-jr.service');
const whatsapp = require('../../whatsapp/envio-whatsapp.service');
const zapi = require('../../integracoes/zapi.service');

const DEFAULTS = [
  ['EM_PRODUCAO','Em produção',`📦 Pedido nº {pedido}\n\nCliente: {cliente}\nValor do pedido: {valor_pedido}\n\nSeu pedido entrou em produção em {data}.\n\nPEDIDO PRONTO EM (PREVISÃO): {previsao}`,true],
  ['PEDIDO_PRONTO','Pedido pronto',`📦 Pedido nº {pedido}\n\nCliente: {cliente}\nValor do pedido: {valor_pedido}\n\nSeu pedido ficou pronto em {data}.`,true],
  ['QTDE_VOLUMES','Quantidade de volumes','',false],
  ['ETIQUETA_VOLUMES','Etiqueta de volumes',`📦 Pedido nº {pedido}\n\nCliente: {cliente}\n\nConfirma os dizeres abaixo para a etiqueta de volumes deste pedido?\n\n{etiqueta_texto}`,true],
  ['VIDEO_FEITO','Vídeo feito','',false],
  ['QUER_NOTA_FISCAL','Quer nota fiscal','Vai precisar de Nota Fiscal? Preciso calcular os impostos para acrescentar se for querer.',true],
  ['LOCAL_ENTREGA','Local de entrega',`MENSAGEM AUTOMÁTICA - ALUMÍNIO JR\n{data_carrada} - {descricao_carrada}\n\nNome cliente: {cliente}\nNúmero pedido: {pedido}\n{detalhes_entrega}\n\nPrevisão de volumes: {volumes}`,true],
  ['DATA_EXPEDICAO','Data de expedição',`MENSAGEM AUTOMÁTICA - ALUMÍNIO JR\n📦 Pedido nº {pedido}\n\nSeu pedido foi expedido em {data_expedicao}.`,true],
  ['LIGACAO_POS_VENDA','Ligação pós-venda','',false],
  ['PAGAMENTO_QUITADO','Pagamento quitado','',false],
  ['LOCAL_ENTREGA_LOGISTICA','Aviso à transportadora/agência',`MENSAGEM AUTOMÁTICA - ALUMÍNIO JR\n{data_carrada} - {descricao_carrada}\n\nNome cliente: {cliente_telefone}\nCidade cliente: {cidade_uf}\nNúmero pedido: {pedido}{linha_transportadora}\n\nPrevisão qtde volume: {volumes}`,true],
  ['LOCAL_ENTREGA_REPETICAO','Consulta para repetir entrega',`MENSAGEM AUTOMÁTICA - ALUMÍNIO JR\n📦 Pedido nº {pedido}\n\nNo seu pedido anterior nº {pedido_anterior}, o local de entrega foi:\nTransportadora / excursão: {transportadora_anterior}\nRedespacho: {redespacho_anterior}\nAgência de recebimento: {agencia_anterior}\n\nPodemos repetir estes mesmos dados de entrega neste pedido?`,true]
];
const MAP = new Map(DEFAULTS.map(([codigo, nome, texto, ativo])=>[codigo,{codigo,nome,texto,ativo}]));
const VARIAVEIS = [
 ['cliente','Nome do cliente'],['pedido','Número do pedido'],['carrada','Código da carrada'],
 ['fase','Nome da fase'],['data','Data de hoje'],['data_carrada','Data da carrada'],
 ['descricao_carrada','Descrição da carrada'],['previsao','Previsão de pedido pronto'],
 ['valor_pedido','Valor do pedido'],['quantidade_itens','Quantidade de itens'],
 ['volumes','Quantidade de volumes'],['vendedor','Vendedor'],['cidade','Cidade'],
 ['empresa','Nome da empresa'],['data_expedicao','Data de expedição'],
 ['etiqueta_texto','Texto da etiqueta'],['detalhes_entrega','Dados do destino'],
 ['cliente_telefone','Nome e telefone do cliente'],['cidade_uf','Cidade e UF do cliente'],['linha_transportadora','Informação da transportadora'],
 ['pedido_anterior','Pedido anterior'],['transportadora_anterior','Transportadora anterior'],
 ['redespacho_anterior','Redespacho anterior'],['agencia_anterior','Agência anterior']
];
const VARS = new Set(VARIAVEIS.map(([v])=>v));
let estruturaPromise;
async function garantir() {
  if (!estruturaPromise) estruturaPromise = (async()=>{
    await pool.query(`CREATE TABLE IF NOT EXISTS progresso_notificacoes_geral (
      id SMALLINT PRIMARY KEY DEFAULT 1 CHECK(id=1), texto_ativo BOOLEAN NOT NULL DEFAULT TRUE,
      audio_ativo BOOLEAN NOT NULL DEFAULT FALSE, atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now())`);
    await pool.query(`CREATE TABLE IF NOT EXISTS progresso_notificacoes_fases (
      codigo VARCHAR(65) PRIMARY KEY, nome VARCHAR(120) NOT NULL, texto TEXT NOT NULL DEFAULT '',
      texto_ativo BOOLEAN NOT NULL DEFAULT FALSE, audio_ativo BOOLEAN NOT NULL DEFAULT TRUE,
      audio_chave TEXT, audio_mime VARCHAR(60), audio_origem VARCHAR(25),
      audio_voz_id TEXT, audio_voz_nome TEXT, audio_modelo TEXT, audio_texto TEXT,
      atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now())`);
    await pool.query('INSERT INTO progresso_notificacoes_geral(id) VALUES (1) ON CONFLICT DO NOTHING');
    for (const [codigo,nome,texto,ativo] of DEFAULTS) {
      await pool.query(`INSERT INTO progresso_notificacoes_fases(codigo,nome,texto,texto_ativo)
        VALUES($1,$2,$3,$4) ON CONFLICT(codigo) DO NOTHING`,[codigo,nome,texto,ativo]);
    }
  })().catch(err=>{estruturaPromise=null; throw err;});
  return estruturaPromise;
}
function validacaoTexto(txt) {
  const texto=String(txt == null ? '' : txt);
  if(texto.length>5000) throw erro('Mensagem limitada a 5.000 caracteres.');
  const encontrados=[...texto.matchAll(/\{([^{}]+)\}/g)];
  const desconhecidos=encontrados.map(m=>m[1]).filter(v=>!VARS.has(v));
  if(desconhecidos.length) throw erro(`Variáveis desconhecidas: ${[...new Set(desconhecidos)].join(', ')}.`);
  return texto;
}
function erro(msg,status=400){const e=new Error(msg);e.statusCode=status;return e;}
async function listar(){
  await garantir();
  const [geral,fases]=await Promise.all([pool.query('SELECT * FROM progresso_notificacoes_geral WHERE id=1'),pool.query('SELECT * FROM progresso_notificacoes_fases ORDER BY codigo')]);
  return { geral:geral.rows[0],fases:fases.rows,variaveis:VARIAVEIS.map(([codigo,nome])=>({codigo,nome})) };
}
async function salvarGeral(data){
  await garantir();
  if(typeof data.textoAtivo!=='boolean'||typeof data.audioAtivo!=='boolean')throw erro('Informe os seletores ON/OFF de texto e áudio.');
  await pool.query(`UPDATE progresso_notificacoes_geral SET texto_ativo=$1,audio_ativo=$2,atualizado_em=now() WHERE id=1`,[data.textoAtivo,data.audioAtivo]);
  return (await listar()).geral;
}
async function fase(codigo){
  await garantir();
  if(!MAP.has(codigo))throw erro('Fase não reconhecida.',404);
  const {rows}=await pool.query('SELECT * FROM progresso_notificacoes_fases WHERE codigo=$1',[codigo]);
  return rows[0];
}
async function salvarFase(codigo,body){
  await fase(codigo);
  if(typeof body.textoAtivo!=='boolean'||typeof body.audioAtivo!=='boolean')throw erro('Informe os controles individuais ON/OFF.');
  const texto=validacaoTexto(body.texto);
  const {rows}=await pool.query(`UPDATE progresso_notificacoes_fases SET texto=$2,texto_ativo=$3,audio_ativo=$4,atualizado_em=now() WHERE codigo=$1 RETURNING *`,[codigo,texto,body.textoAtivo,body.audioAtivo]);
  return rows[0];
}
function renderizar(texto,contexto){
  const ausentes=new Set();
  const result=String(texto||'').replace(/\{([^{}]+)\}/g,(_,nome)=>{
    if(!VARS.has(nome))throw erro(`Variável não permitida: ${nome}`,400);
    const v=contexto[nome];
    if(v==null||v==='')ausentes.add(nome);
    return v==null?'':String(v);
  });
  // Os valores opcionais vazios são tolerados (ex. vendedor não cadastrado).
  return result.trim();
}
async function carregar(codigo){
  await garantir();
  const [gResult,f]=await Promise.all([pool.query('SELECT texto_ativo,audio_ativo FROM progresso_notificacoes_geral WHERE id=1'),fase(codigo)]);
  const g=gResult.rows[0];
  return {enviarTexto:Boolean(g.texto_ativo&&f.texto_ativo&&f.texto.trim()),enviarAudio:Boolean(g.audio_ativo&&f.audio_ativo&&f.audio_chave),f};
}
async function obterAudioBytes(chave){
  if(!/^progresso-audios\/[\w./-]+$/.test(chave)||chave.includes('..'))throw erro('Arquivo de áudio inválido.',400);
  const env=process.env;
  const account=String(env.CLOUDFLARE_R2_ACCOUNT_ID||env.CLOUDFLARE_ACCOUNT_ID||'').trim();
  const bucket=String(env.CLOUDFLARE_R2_BUCKET||'').trim();
  const endpoint=String(env.CLOUDFLARE_R2_ENDPOINT||`https://${account}.r2.cloudflarestorage.com`).trim();
  if(!account||!bucket||!env.CLOUDFLARE_R2_ACCESS_KEY_ID||!env.CLOUDFLARE_R2_SECRET_ACCESS_KEY) throw erro('Armazenamento R2 indisponível.',503);
  const client=new S3Client({region:'auto',endpoint,credentials:{accessKeyId:env.CLOUDFLARE_R2_ACCESS_KEY_ID,secretAccessKey:env.CLOUDFLARE_R2_SECRET_ACCESS_KEY}});
  const obj=await client.send(new GetObjectCommand({Bucket:bucket,Key:chave}));
  const parts=[];let size=0;
  for await(const chunk of obj.Body){size+=chunk.length;if(size>6*1024*1024)throw erro('Arquivo armazenado excede limite.',413);parts.push(chunk);}
  return Buffer.concat(parts);
}
async function apagarArquivo(chave){
  if(!chave||!chave.startsWith('progresso-audios/'))return;
  const env=process.env,account=env.CLOUDFLARE_R2_ACCOUNT_ID||env.CLOUDFLARE_ACCOUNT_ID;
  const client=new S3Client({region:'auto',endpoint:env.CLOUDFLARE_R2_ENDPOINT||`https://${account}.r2.cloudflarestorage.com`,credentials:{accessKeyId:env.CLOUDFLARE_R2_ACCESS_KEY_ID,secretAccessKey:env.CLOUDFLARE_R2_SECRET_ACCESS_KEY}});
  await client.send(new DeleteObjectCommand({Bucket:env.CLOUDFLARE_R2_BUCKET,Key:chave}));
}
async function converterMicrofone(buffer,mime){
  if(!/^audio\/(webm|ogg|mp4|mpeg|mp3)(?:;.*)?$/i.test(mime))throw erro('Formato de gravação incompatível.');
  if(!Buffer.isBuffer(buffer)||!buffer.length||buffer.length>5*1024*1024)throw erro('Gravação vazia ou maior que 5 MB.',413);
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ajr-progresso-'));
  const entrada=path.join(dir,'entrada'),saida=path.join(dir,'saida.mp3');
  try {
    await fs.writeFile(entrada,buffer);
    const bin=require('ffmpeg-static');
    await new Promise((resolve,reject)=>{
      const p=spawn(bin,['-nostdin','-loglevel','error','-y','-i',entrada,'-vn','-ac','1','-ar','44100','-b:a','96k',saida]);
      let info='';p.stderr.on('data',d=>{info+=String(d).slice(0,500)});
      p.on('error',reject);p.on('close',code=>code===0?resolve():reject(erro('Não foi possível converter gravação para MP3: '+info.slice(0,160),422)));
    });
    const convertido=await fs.readFile(saida);
    if(!convertido.length||convertido.length>5*1024*1024)throw erro('Áudio convertido inválido ou maior que 5 MB.',413);
    return convertido;
  } finally {await fs.rm(dir,{recursive:true,force:true});}
}
async function salvarAudio(codigo,{bytes,origem,mime='audio/mpeg',vozId=null,vozNome=null,modelo=null,texto=null}){
  const anterior=await fase(codigo);
  if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>5*1024*1024)throw erro('Áudio vazio ou maior que 5 MB.',413);
  const enviado=await r2.uploadBuffer(bytes,{pasta:'progresso-audios',nome:`${codigo.toLowerCase()}-${randomUUID()}.mp3`,contentType:'audio/mpeg'});
  try{
    const {rows}=await pool.query(`UPDATE progresso_notificacoes_fases SET audio_chave=$2,audio_mime=$3,audio_origem=$4,audio_voz_id=$5,audio_voz_nome=$6,audio_modelo=$7,audio_texto=$8,atualizado_em=now() WHERE codigo=$1 RETURNING *`,[codigo,enviado.key,'audio/mpeg',origem,vozId,vozNome,modelo,texto]);
    // Versões anteriores não são excluídas imediatamente: envios simultâneos podem lê-las.
    return rows[0];
  }catch(e){await apagarArquivo(enviado.key).catch(()=>{});throw e;}
}
async function gerarESalvar(codigo,body){
  await fase(codigo);
  const voz=String(body.voz||'').trim(),modelo=String(body.modelo||'').trim();
  const vozes=await eleven.listarVozes();
  const escolhida=vozes.find(v=>v.voice_id===voz);
  if(!escolhida)throw erro('Selecione uma voz disponível em sua conta ElevenLabs.');
  const modelos=await eleven.listarModelos();
  if(!modelos.some(m=>m.model_id===modelo))throw erro('Modelo ElevenLabs indisponível.');
  const audio=await eleven.gerarAudio({texto:body.texto,voz,modelo});
  return salvarAudio(codigo,{bytes:audio.bytes,origem:'elevenlabs',vozId:voz,vozNome:escolhida.name,modelo,texto:audio.texto});
}
async function salvarGravacao(codigo,buffer,mime){
  await fase(codigo);
  const convertido=await converterMicrofone(buffer,mime);
  return salvarAudio(codigo,{bytes:convertido,origem:'microfone'});
}
async function excluirAudio(codigo){
  const atual=await fase(codigo);
  await pool.query(`UPDATE progresso_notificacoes_fases SET audio_chave=NULL,audio_mime=NULL,audio_origem=NULL,audio_voz_id=NULL,audio_voz_nome=NULL,audio_modelo=NULL,audio_texto=NULL,atualizado_em=now() WHERE codigo=$1`,[codigo]);
  // Por segurança, o antigo arquivo só é desvinculado: evita apagar mídia de um envio em curso.
  return {codigo,excluido:true,antigoArquivoDesvinculado:Boolean(atual.audio_chave)};
}
async function enviar({codigo,telefone,contexto={},registro}){
  const cfg=await carregar(codigo);
  const resultado={texto:null,audio:null};
  if(!cfg.enviarTexto&&!cfg.enviarAudio)return resultado;
  const numero=String(telefone||'').replace(/\D/g,'');
  if(!numero) {
    if(typeof registro==='function'){
      if(cfg.enviarTexto)await registro({tipo:'texto',mensagem:renderizar(cfg.f.texto,contexto),sucesso:false,resposta:{error:'Cliente sem telefone'},telefone:''}).catch(()=>{});
      if(cfg.enviarAudio)await registro({tipo:'audio',mensagem:cfg.f.audio_texto||'[áudio gravado]',sucesso:false,resposta:{error:'Cliente sem telefone'},telefone:''}).catch(()=>{});
    }
    return {texto:cfg.enviarTexto?{success:false,error:'Cliente sem telefone'}:null,audio:cfg.enviarAudio?{success:false,error:'Cliente sem telefone'}:null};
  }
  async function log(tipo,mensagem,sucesso,resposta){
    if(typeof registro==='function')try{await registro({tipo,mensagem,sucesso,resposta,telefone:numero});}catch(e){console.error('[Progresso notificações] Falha ao registrar:',e.message);}
  }
  if(cfg.enviarTexto){
    const mensagem=renderizar(cfg.f.texto,contexto);
    try{const sent=await whatsapp.enviarMensagem({telefone:numero,mensagem});resultado.texto={success:true,telefone:sent.telefone};await log('texto',mensagem,true,sent.zapi||sent);}
    catch(e){resultado.texto={success:false,error:e.message};await log('texto',mensagem,false,{error:e.message});}
  }
  if(cfg.enviarAudio){
    try{
      const bytes=await obterAudioBytes(cfg.f.audio_chave);
      // Arquivos R2 persistidos em MP3; não fazer síntese no momento do clique.
      const sent=await zapi.postZapi('/send-audio',{phone:numero,audio:`data:audio/mpeg;base64,${bytes.toString('base64')}`});
      resultado.audio={success:true,idMensagem:sent.zapi?.messageId||sent.zapi?.id||null};
      await log('audio',cfg.f.audio_texto||'[áudio gravado]',true,{tipo:'audio_permanente',key:cfg.f.audio_chave,idMensagem:resultado.audio.idMensagem});
    }catch(e){resultado.audio={success:false,error:e.message};await log('audio',cfg.f.audio_texto||'[áudio gravado]',false,{tipo:'audio_permanente',error:e.message});}
  }
  return resultado;
}
module.exports={DEFAULTS,VARIAVEIS,garantir,listar,salvarGeral,salvarFase,fase,renderizar,carregar,obterAudioBytes,gerarESalvar,salvarGravacao,excluirAudio,enviar};
