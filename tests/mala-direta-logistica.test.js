'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
function source(file){return fs.readFileSync(path.join(__dirname,'..',file),'utf8');}
const utilsModule={exports:{}};
new Function('module',source('src/services/logistica/importacaoExcursoesUtils.js'))(utilsModule);
const utils=utilsModule.exports;
function setup(){
  const writes=[],readQueries=[];
  const transportadoras=[
    {id:1,nome:'Empresa A',telefone_principal:'5583999999999',telefone:'5583999999999 / 5581988887777',cidade_nome:'Santa Cruz do Capibaribe',cidade_estado:'PE'},
    {id:2,nome:'Empresa B',telefone:'5583988886666'}
  ];
  const agencias=[{codigo:5,nome:'Agencia C',telefone:'5581988887777 / 5584988885555',cidade_nome:'Patos',cidade_estado:'PB'}];
  const pool={
    async query(sql,args){
      readQueries.push({sql,args});
      if(sql.includes('SELECT DISTINCT id,nome,estado FROM ('))return {rows:[{id:1,nome:'Santa Cruz do Capibaribe',estado:'PE'},{id:2,nome:'Patos',estado:'PB'}]};
      if(sql.includes('FROM transportadoras t'))return {rows:transportadoras};
      if(sql.includes('FROM agencias_recebimento a'))return {rows:agencias};
      if(sql.includes('FROM mala_direta_bloqueios WHERE telefone=ANY'))return {rows:[{telefone:'5583999999999'}]};
      if(sql.includes('SELECT id, nome, item_legado FROM produtos'))return {rows:[{id:3,nome:'Produto de teste',item_legado:null}]};
      if(sql.includes('CREATE TABLE IF NOT EXISTS mala_direta_campanhas'))return {rows:[]};
      throw Error('SQL inesperado: '+sql.slice(0,100));
    },
    async connect(){return {
      async query(sql,args){writes.push({sql,args});return sql.includes('INSERT INTO mala_direta_campanhas')?{rows:[{id:42}]}:{rows:[]};},
      release(){}
    };}
  };
  const logModule={exports:{}};
  new Function('require','module',source('src/services/mala-direta/mala-direta-logistica.service.js'))(
    name=>name.includes('db/connection')?pool:utils,logModule
  );
  const log=logModule.exports;
  const svcModule={exports:{}};
  new Function('require','module',source('src/services/mala-direta/mala-direta.service.js'))(
    name=>name.includes('db/connection')?pool:name==='./mala-direta-logistica.service'?log:{},svcModule
  );
  return {log,svc:svcModule.exports,writes,readQueries};
}
test('logistica seleciona todos os telefones validos uma unica vez e respeita bloqueios',async()=>{
  const {log}=setup();
  const todos=await log.consultar('todos');
  assert.equal(todos.length,4);
  assert.equal(new Set(todos.map(c=>c.telefone)).size,4);
  assert.equal(todos.filter(c=>c.bloqueado).length,1);
  assert.equal((await log.consultar('transportadoras')).length,3);
  assert.equal((await log.consultar('agencias')).length,2);
  await assert.rejects(()=>log.consultar('incorreto'),/inválido/);
});
test('cidades da logística usam apenas o cadastro da transportadora com DISTINCT, sem cidades de rotas',async()=>{
  const {log,readQueries}=setup();
  const cidades=await log.cidades('transportadoras');
  assert.equal(cidades.length,2);
  const lista=readQueries.find(q=>q.sql.includes('SELECT DISTINCT id,nome,estado FROM ('));
  assert.ok(lista);
  assert.match(lista.sql,/SELECT DISTINCT id,nome,estado/);
  assert.match(lista.sql,/FROM transportadoras t INNER JOIN cidades c ON c.id=t.cidade_id/);
  assert.doesNotMatch(lista.sql,/transportadora_cidade/);
  assert.doesNotMatch(lista.sql,/agencias_recebimento/);
  await log.consultar('transportadoras',1);
  const consulta=readQueries.find(q=>q.sql.includes('SELECT t.id,t.nome,t.telefone'));
  assert.ok(consulta);
  assert.match(consulta.sql,/t.cidade_id=\\$1/);
  assert.doesNotMatch(consulta.sql,/transportadora_cidade/);
  assert.deepEqual(consulta.args,[1]);
  await log.cidades('agencias');
  const listaAgencias=readQueries.filter(q=>q.sql.includes('SELECT DISTINCT id,nome,estado FROM (')).at(-1);
  assert.match(listaAgencias.sql,/agencias_recebimento a ON a.cidade_id=c.id/);
  assert.doesNotMatch(listaAgencias.sql,/FROM transportadoras t/);
});
test('campanha logistica valida contatos no servidor e agenda intervalo e janela',async()=>{
  const {log,svc,writes}=setup();
  const contato=(await log.consultar('todos')).find(x=>!x.bloqueado);
  const dados={produtoId:3,tipoPublico:'logistica',grupoLogistica:'todos',
    cidadeLogistica:1,intervaloMinutos:15,horarioInicio:'08:00',horarioFim:'18:00',
    mensagem:'Divulgacao autorizada',confirmouConsentimento:true,
    destinatarios:[{referencia:contato.referencia,autorizado:true}],
    imagem:'data:image/png;base64,aGVsbG8=',audioOrigem:'nenhum'};
  const criado=await svc.criar(dados,'https://example.com',{});
  assert.equal(criado.total,1);
  const camp=writes.find(x=>x.sql.includes('INSERT INTO mala_direta_campanhas'));
  assert.equal(camp.args[6],900);
  assert.equal(camp.args[14],'08:00');
  assert.equal(camp.args[15],'18:00');
  assert.equal(camp.args[16],1);
  const linha=writes.find(x=>x.sql.includes('INSERT INTO mala_direta_destinatarios'));
  assert.equal(linha.args[1],null);
  assert.equal(linha.args[4],'logistica');
  assert.equal(linha.args[5],contato.referencia);
  await assert.rejects(()=>svc.criar({...dados,horarioInicio:'19:00',horarioFim:'08:00'},'https://example.com',{}),/horário inicial/);
  await assert.rejects(()=>svc.criar({...dados,destinatarios:[{referencia:'t:999:5583000000000',autorizado:true}]},'https://example.com',{}),/não encontrado/);
  await assert.rejects(()=>svc.criar({...dados,confirmouConsentimento:false},'https://example.com',{}),/autorização/);
  await assert.rejects(()=>svc.criar({...dados,cidadeLogistica:null},'https://example.com',{}),/cidade/);
});
test('interface e agendamento do worker mantem sintaxe valida',()=>{
  const view=source('views/whatsapp/mala-direta.html');
  const script=view.split('<script>')[1].split('</script>')[0];
  assert.doesNotThrow(()=>new Function(script));
  const backend=source('src/services/mala-direta/mala-direta.service.js');
  assert.match(backend,/NOW\(\) AT TIME ZONE 'America\/Fortaleza'/);
  assert.match(view,/id="grupoLogistica"/);
  assert.match(view,/id="cidadeLogistica"/);
  assert.match(view,/id="modalContatos"/);
  assert.match(view,/id="simChat"/);
  assert.match(view,/id="adicionarAudioEleven"/);
  assert.match(view,/id="origemDestinatarios"/);
  assert.match(view,/id="horarioInicio"/);
  assert.match(view,/id="horarioFim"/);
});

test('campanha valida e guarda ordem de foto, áudio e texto, sem repetir contatos',async()=>{
  const {log,svc,writes}=setup();
  const contato=(await log.consultar('transportadoras',1)).find(x=>!x.bloqueado);
  const params={
    produtoId:3,tipoPublico:'logistica',grupoLogistica:'transportadoras',cidadeLogistica:1,
    intervaloMinutos:15,horarioInicio:'08:00',horarioFim:'18:00',
    confirmouConsentimento:true,destinatarios:[{referencia:contato.referencia,autorizado:true}],
    sequencia:[
      {tipo:'imagem',imagem:'data:image/png;base64,aGVsbG8='},
      {tipo:'texto',texto:'Oferta autorizada'},
      {tipo:'imagem',imagem:'data:image/png;base64,aGVsbG8='},
      {tipo:'texto',texto:'Para sair, responda SAIR'}
    ]
  };
  assert.equal((await svc.criar(params,'https://example.com',{})).total,1);
  const insert=writes.find(x=>x.sql.includes('INSERT INTO mala_direta_campanhas'));
  const etapas=JSON.parse(insert.args[17]);
  assert.deepEqual(etapas.map(x=>x.tipo),['imagem','texto','imagem','texto']);
  assert.equal(insert.args[16],1);
  await assert.rejects(()=>svc.criar({...params,sequencia:[{tipo:'invalido'}]},'https://example.com',{}),/Tipo de mensagem inválido/);
  await assert.rejects(()=>svc.criar({...params,sequencia:[]},'https://example.com',{}),/sequência/);
});
