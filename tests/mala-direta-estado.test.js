'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

function montar(){
  let rascunho=null;
  const sql=[];
  const pool={
    async query(query,args=[]){
      sql.push(String(query));
      if(String(query).includes('CREATE TABLE IF NOT EXISTS mala_direta_campanhas'))
        return {rows:[]};
      if(String(query).includes('INSERT INTO mala_direta_rascunhos')){
        rascunho={estado:JSON.parse(args[1]),atualizado_em:'2026-11-17T20:00:00Z'};
        return {rows:[{atualizado_em:rascunho.atualizado_em}]};
      }
      if(String(query).includes('SELECT estado,atualizado_em FROM mala_direta_rascunhos'))
        return {rows:rascunho?[rascunho]:[]};
      if(String(query).includes('DELETE FROM mala_direta_rascunhos')){
        rascunho=null;return {rowCount:1,rows:[]};
      }
      if(String(query).includes('AS sequencia_resumo')){
        return {rows:[{id:12,produto_nome:'Panela',status:'ativa',
          proximo_envio_em:'2026-11-17T21:00:00Z',
          sequencia_resumo:[{tipo:'imagem',imagem:'https://example.com/foto.jpg'},
            {tipo:'texto',texto:'Oferta autorizada'},{tipo:'audio',origem:'arquivo'}]}]};
      }
      if(String(query).includes('encode(audio_mp3')){
        return {rows:[{id:12,produto_id:7,produto_nome:'Panela',status:'pausada',
          sequencia_mensagens:[{tipo:'texto',texto:'Promoção autorizada'},{tipo:'audio',origem:'arquivo',mp3:'bXAz'}]}]};
      }
      if(String(query).includes('FROM mala_direta_destinatarios WHERE campanha_id')){
        return {rows:[{telefone:'5583999999999',nome:'Contato A',status:'enviado',etapa_enviada_index:1},
          {telefone:'5583988888888',nome:'Contato B',status:'pendente',etapa_enviada_index:-1}]};
      }
      throw Error('SQL inesperado: '+String(query).slice(0,90));
    }
  };
  const file=fs.readFileSync(path.join(__dirname,'../src/services/mala-direta/mala-direta.service.js'),'utf8');
  const mod={exports:{}};
  new Function('require','module',file)((name)=>name.includes('db/connection')?pool:{},mod);
  return {svc:mod.exports,sql};
}

test('rascunho da campanha persiste e recupera ordem, áudio original e contatos selecionados',async()=>{
  const {svc}=montar();
  const estado={
    campos:{produtoId:'7',horarioInicio:'08:00',horarioFim:'18:00'},
    destinatarios:[{referencia:'t:1:5583999999999',marcado:true,nome:'Contato A'}],
    sequencia:[{tipo:'texto',texto:'Oferta autorizada'},
      {tipo:'audio',audioOrigem:'arquivo',audioData:'data:audio/ogg;base64,T2dnUw==',nomeArquivo:'mensagem.ogg'}]
  };
  await svc.salvarRascunho('admin',estado);
  const lido=await svc.lerRascunho('admin');
  assert.deepEqual(lido.estado,estado);
  assert.equal(lido.estado.destinatarios.length,1);
  assert.equal(lido.estado.sequencia[1].nomeArquivo,'mensagem.ogg');
  await svc.excluirRascunho('admin');
  assert.equal(await svc.lerRascunho('admin'),null);
});

test('rascunho limita mensagens, áudios inválidos e dados grandes',async()=>{
  const {svc}=montar();
  const base={campos:{},destinatarios:[],sequencia:[]};
  await assert.rejects(()=>svc.salvarRascunho('admin',{...base,sequencia:Array(31).fill({tipo:'texto',texto:'teste'})}),/30 mensagens/);
  await assert.rejects(()=>svc.salvarRascunho('admin',{...base,sequencia:[{tipo:'audio',audioOrigem:'arquivo',audioData:'javascript:abc'}]}),/inválido/);
  await assert.rejects(()=>svc.salvarRascunho('admin',{...base,destinatarios:Array(2001).fill({nome:'teste'})}),/2.000/);
  await assert.rejects(()=>svc.salvarRascunho('',base),/Usuário administrativo/);
});

test('campanha aberta recupera a sequência enviada e o checkpoint individual',async()=>{
  const {svc,sql}=montar();
  const d=await svc.estadoCampanha(12);
  assert.equal(d.campanha.status,'pausada');
  assert.deepEqual(d.campanha.sequencia_mensagens.map(m=>m.tipo),['texto','audio']);
  assert.deepEqual(d.destinatarios.map(x=>x.status),['enviado','pendente']);
  assert.deepEqual(d.destinatarios.map(x=>x.etapa_enviada_index),[1,-1]);
  assert.ok(sql.some(s=>s.includes('encode(audio_mp3')));
});

test('a tela possui salvamento, recuperação, revisão dos contatos e mantém JavaScript válido',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../views/whatsapp/mala-direta.html'),'utf8');
  const script=html.split('<script>')[1].split('</script>')[0];
  assert.doesNotThrow(()=>new Function(script));
  for(const id of ['salvarRascunho','rascunhoStatus','campanhaRetomada','campanhaDestinatarios','retomarCampanha','montarNova','simChat'])
    assert.ok(html.includes('id="'+id+'"'),id);
  assert.match(script,/await restaurarRascunho\(\)/);
  assert.match(script,/function serializarRascunho\(/);
  assert.match(script,/GET_TODO_NAO_USADO|sem reenvio automático|já realizados não serão repetidos/);
});

test('relatório mostra por destinatário as etapas aceitas sem expor o áudio base64',async()=>{
  const {svc,sql}=montar();
  const relatorio=await svc.detalhe(12);
  assert.equal(relatorio.campanha.status,'ativa');
  assert.deepEqual(relatorio.campanha.sequencia_resumo.map(e=>e.tipo),['imagem','texto','audio']);
  assert.equal(relatorio.campanha.sequencia_resumo[1].texto,'Oferta autorizada');
  assert.ok(sql.some(q=>q.includes('jsonb_array_elements(sequencia_mensagens)')));
  assert.ok(sql.some(q=>q.includes('etapas_aceitas')));
  assert.ok(!JSON.stringify(relatorio).includes('bXAz'));
});

test('histórico aparece em campanhas e relatórios e o painel iniciar não flutua',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../views/whatsapp/mala-direta.html'),'utf8');
  const script=html.split('<script>')[1].split('</script>')[0];
  assert.doesNotThrow(()=>new Function(script));
  for(const id of ['historicoMensagens','historicoResumo','historicoLinhas','historicoTitulo'])
    assert.ok(html.includes('id="'+id+'"'),id);
  assert.ok(html.includes('.bottom{position:static;'), 'painel iniciar deve acompanhar o scroll normal');
  assert.match(script,/function historicoDaCampanha\(/);
  assert.match(script,/function renderizarHistorico\(/);
  assert.match(script,/historico\.onclick=\(\)=>carregarHistorico/);
  assert.match(script,/finally\{\$\('enviar'\)\.disabled=!!campanhaVisualizada/);
});


test('envio em sequência persiste checkpoint e conclusão com parâmetros SQL tipados',()=>{
  const service=fs.readFileSync(path.join(__dirname,'../src/services/mala-direta/mala-direta.service.js'),'utf8');
  // A foto aceita é registrada antes do texto/áudios. Os parâmetros usados em
  // colunas tipadas e funções jsonb não podem ficar com inferências conflitantes.
  assert.match(service,/SET etapa_enviada_index=\$2::integer,/);
  assert.match(service,/jsonb_build_object\('indice',\$2::integer,'tipo',\$3::text/);
  assert.match(service,/SET status=\$2::varchar\(24\),/);
  assert.match(service,/WHEN \$2::varchar\(24\)='enviado' THEN NOW\(\)/);
  assert.match(service,/erro\?'incerto':'enviado'/);
  assert.match(service,/Falha na sequência:/);
});


function simularFila({erroNoTexto=null}={}){
  const eventos=[],etapas=[
    {tipo:'imagem',imagem:'https://example.com/foto.jpg'},
    {tipo:'texto',texto:'Promoção autorizada'},
    {tipo:'audio',mp3:'bXAz'}, {tipo:'audio',mp3:'bXAz'},
    {tipo:'audio',mp3:'bXAz'}, {tipo:'audio',mp3:'bXAz'}
  ];
  const trabalho={id:51,campanha_id:5,telefone:'5583999999999',etapa_enviada_index:-1,
    intervalo_segundos:600,sequencia_mensagens:etapas};
  const query=async(sql,args=[])=>{
    const texto=String(sql);
    if(texto.includes('SELECT pg_try_advisory_xact_lock'))return {rows:[{ok:true}]};
    if(texto.includes('SELECT d.id,d.campanha_id'))return {rows:[trabalho],rowCount:1};
    if(texto.includes('SELECT 1 FROM mala_direta_bloqueios'))return {rows:[],rowCount:0};
    if(texto.includes('SET etapa_enviada_index=$2::integer')){
      eventos.push('checkpoint:'+args[1]);return {rows:[{id:51}],rowCount:1};
    }
    if(texto.includes("SET status=$2::varchar(24)")){
      eventos.push('status:'+args[1]);return {rows:[{id:51}],rowCount:1};
    }
    if(texto.includes("SET proximo_envio_em=NOW()+")){
      eventos.push('agenda:600');return {rowCount:1,rows:[]};
    }
    if(texto.includes("SET status='pausada'")){
      eventos.push('pausada');return {rowCount:1,rows:[]};
    }
    return {rowCount:1,rows:[]};
  };
  const client={query,release(){}};
  const pool={query,async connect(){return client;}};
  const zapi={
    async enviarImagem(){eventos.push('foto');return {success:true};},
    async postZapi(endpoint){
      const tipo=endpoint==='/send-text'?'texto':'audio';
      eventos.push(tipo);
      if(tipo==='texto'&&erroNoTexto)throw erroNoTexto;
      return {success:true};
    }
  };
  const src=fs.readFileSync(path.join(__dirname,'../src/services/mala-direta/mala-direta.service.js'),'utf8')
    .replace('const aguardar=ms=>new Promise(resolve=>setTimeout(resolve,ms));',
      'const aguardar=async ms=>events.push("espera:"+ms);')
    .replace('module.exports={produtos,','module.exports={processarProximo,produtos,');
  const mod={exports:{}};
  new Function('require','module','events',src)(name=>{
    if(name.includes('db/connection'))return pool;
    if(name.includes('integracoes/zapi.service'))return zapi;
    if(name.includes('central-controle.service'))return {ativo:async()=>true};
    return {};
  },mod,eventos);
  return {processar:mod.exports.processarProximo,eventos};
}

test('seis mensagens são aceitas em ordem, com cinco esperas de 5 segundos e 10 minutos somente após concluir',async()=>{
  const {processar,eventos}=simularFila();
  await processar();
  assert.deepEqual(eventos.filter(e=>e==='foto'||e==='texto'||e==='audio'),
    ['foto','texto','audio','audio','audio','audio']);
  assert.equal(eventos.filter(e=>e==='espera:5000').length,5);
  assert.equal(eventos.filter(e=>e.startsWith('checkpoint:')).length,6);
  assert.equal(eventos.filter(e=>e==='agenda:600').length,1);
  assert.ok(eventos.indexOf('agenda:600')>eventos.lastIndexOf('audio'));
  assert.ok(eventos.indexOf('status:enviado')>eventos.lastIndexOf('checkpoint:5'));
});

test('erro ambíguo no texto pausa campanha sem avançar para nenhum áudio',async()=>{
  const erro=new Error('Resposta Z-API indefinida');
  const {processar,eventos}=simularFila({erroNoTexto:erro});
  await processar();
  assert.deepEqual(eventos.filter(e=>['foto','texto','audio'].includes(e)),['foto','texto']);
  assert.ok(eventos.includes('checkpoint:0'));
  assert.ok(eventos.includes('espera:5000'));
  assert.ok(eventos.includes('status:incerto'));
  assert.ok(eventos.includes('pausada'));
  assert.ok(!eventos.includes('agenda:600'));
});

test('resposta HTTP 429 tenta texto até três vezes, aguardando 30 segundos e sem repetir a foto',async()=>{
  const erro=new Error('Z-API respondeu 429: limite');erro.httpStatus=429;
  const {processar,eventos}=simularFila({erroNoTexto:erro});
  await processar();
  assert.equal(eventos.filter(e=>e==='foto').length,1);
  assert.equal(eventos.filter(e=>e==='texto').length,3);
  assert.equal(eventos.filter(e=>e==='espera:30000').length,2);
  assert.ok(eventos.includes('pausada'));
  assert.ok(!eventos.includes('audio'));
});
