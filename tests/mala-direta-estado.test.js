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
