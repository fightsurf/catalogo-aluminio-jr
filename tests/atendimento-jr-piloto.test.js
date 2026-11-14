'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const piloto = require('../src/services/whatsapp/atendimento-jr-piloto.service');
const anterior = {
  ATENDIMENTO_JR_PILOTO: process.env.ATENDIMENTO_JR_PILOTO,
  ATENDIMENTO_JR_NUMEROS_TESTE: process.env.ATENDIMENTO_JR_NUMEROS_TESTE,
  ZAPI_WEBHOOK_INSTANCE_ID: process.env.ZAPI_WEBHOOK_INSTANCE_ID,
  ATENDIMENTO_JR_PERFIL_TOKEN: process.env.ATENDIMENTO_JR_PERFIL_TOKEN
};
test.after(() => {
  for (const [chave,valor] of Object.entries(anterior)) {
    if (valor === undefined) delete process.env[chave]; else process.env[chave] = valor;
  }
});
function preparar() {
  process.env.ATENDIMENTO_JR_PILOTO = '1';
  process.env.ATENDIMENTO_JR_NUMEROS_TESTE = '5583999991234';
  process.env.ZAPI_WEBHOOK_INSTANCE_ID = 'INSTANCIA_PILOTO';
  process.env.ATENDIMENTO_JR_PERFIL_TOKEN = 'TOKEN_TESTE_SEM_API';
}
let proximo = 0;
function evento(texto, extra={}) {
  return {
    type:'ReceivedCallback',instanceId:'INSTANCIA_PILOTO',
    messageId:'TESTE_PILOTO_'+(++proximo),phone:'5583999991234',
    fromMe:false,text:{message:texto},...extra
  };
}
test('não ativa sem liberação explícita nem lista de números',async()=>{
  delete process.env.ATENDIMENTO_JR_PILOTO;
  process.env.ATENDIMENTO_JR_NUMEROS_TESTE = '5583999991234';
  assert.equal(piloto.ativo(),false);
  assert.equal((await piloto.processar(evento('preço da panela'))).motivo,'desligado');
});
test('recusa números não autorizados, mensagens próprias e grupos',async()=>{
  preparar();
  assert.equal((await piloto.processar(evento('preço da panela',{phone:'5583999998888'}))).motivo,'fora_do_piloto');
  assert.equal((await piloto.processar(evento('oi',{fromMe:true}))).motivo,'evento_ignorado');
  assert.equal((await piloto.processar(evento('oi',{isGroup:true}))).motivo,'evento_ignorado');
});
test('preços são ajustados pelo perfil e nunca publicados em valor-base',()=>{
  assert.equal(piloto.precoComPerfil(40,{tipo:'percentual',valor:10}),44);
  assert.equal(piloto.precoComPerfil(40,{tipo:'fixo',valor:5}),45);
  assert.equal(piloto.precoComPerfil(null,{tipo:'fixo',valor:5}),null);
  assert.equal(piloto.precoComPerfil(40,null),null);
});
test('interpreta lista de produtos sem acrescentar itens inexistentes',()=>{
  const dados=piloto.reconhecerResposta(JSON.stringify({
    intencao:'consulta',produtos:[{termo:'panela 4 litros',quantidade:10},{termo:'panela 6 litros'}],
    foto:true,video:false
  }));
  assert.deepEqual(dados.produtos,[
    {termo:'panela 4 litros',quantidade:10},
    {termo:'panela 6 litros',quantidade:null}
  ]);
  assert.equal(dados.foto,true);
});
test('responde múltiplos produtos de uma vez e deduplica o webhook',async()=>{
  preparar();
  const respostas=[], consultados=[];
  const deps={
    nivelAtendimento:async()=> 'IA',
    interpretar:async()=>({intencao:'consulta',produtos:[
      {termo:'panela 4',quantidade:2},{termo:'panela 6',quantidade:3}
    ],foto:false,video:false}),
    carregarPerfil:async()=>({tipo:'percentual',valor:10}),
    buscarProdutos:async(itens)=>{consultados.push(itens);return {texto:'Panela 4: R$ 44,00\nPanela 6: R$ 55,00',midias:[]};},
    enviarResposta:async(_tel,msg,tipo)=>respostas.push({msg,tipo})
  };
  const e=evento('preço da 4 e da 6');
  assert.equal((await piloto.processar(e,deps)).acao,'respondeu');
  assert.equal((await piloto.processar(e,deps)).motivo,'duplicado');
  assert.equal(consultados.length,1);
  assert.equal(respostas.length,1);
  assert.match(respostas[0].msg,/Panela 4/);
  assert.match(respostas[0].msg,/Panela 6/);
  assert.equal(respostas[0].tipo,'texto');
});
test('áudio recebido passa por transcrição e responde no mesmo formato',async()=>{
  preparar();
  const resposta=[];
  const e=evento('',{text:undefined,audio:{audioUrl:'https://example.org/test.ogg',mimeType:'audio/ogg'}});
  const deps={
    nivelAtendimento:async()=> 'IA',
    transcrever:async()=> 'Qual o preço da panela?',
    interpretar:async(texto)=>{assert.match(texto,/panela/);return {intencao:'consulta',produtos:[],foto:false,video:false};},
    enviarResposta:async(_tel,msg,tipo)=>resposta.push({msg,tipo})
  };
  assert.equal((await piloto.processar(e,deps)).acao,'orientou');
  assert.equal(resposta[0].tipo,'audio');
});
test('pedido é transferido ao humano e novas mensagens não são atendidas',async()=>{
  preparar();
  let nivel='IA', avisos=0, respostas=0;
  const deps={
    nivelAtendimento:async()=>nivel,
    interpretar:async()=>({intencao:'compra',produtos:[],foto:false,video:false}),
    entregarHumano:async()=>{nivel='HUMANO';},
    enviarResposta:async()=>{respostas++;},
    avisarVendedor:async()=>{avisos++;}
  };
  assert.equal((await piloto.processar(evento('quero fechar pedido'),deps)).acao,'transferido');
  assert.equal((await piloto.processar(evento('oi de novo'),deps)).motivo,'vendedor_assumiu');
  assert.equal(avisos,1);
  assert.equal(respostas,1);
});
test('sem perfil comercial, passa ao vendedor sem revelar preço-base',async()=>{
  preparar();
  delete process.env.ATENDIMENTO_JR_PERFIL_TOKEN;
  const respostas=[];
  const deps={
    nivelAtendimento:async()=> 'IA',
    interpretar:async()=>({intencao:'consulta',produtos:[{termo:'panela 4',quantidade:null}],foto:false,video:false}),
    entregarHumano:async()=>{},
    enviarResposta:async(_tel,msg)=>respostas.push(msg),
    avisarVendedor:async()=>{}
  };
  assert.equal((await piloto.processar(evento('quanto custa a 4'),deps)).acao,'sem_perfil_transferido');
  assert.equal(respostas.length,1);
  assert.doesNotMatch(respostas[0],/R\$/);
});

test('mensagem manual do vendedor suspende o bot sem disparar resposta',async()=>{
  preparar();
  let entregue=0;
  const resultado=await piloto.processar(evento('Vou te atender',{fromMe:true,fromApi:false}),{
    entregarHumano:async()=>{entregue++;}
  });
  assert.equal(resultado.acao,'vendedor_assumiu_manualmente');
  assert.equal(entregue,1);
});
test('perfil comercial inexistente aciona vendedor e não expõe preço',async()=>{
  preparar();
  const enviados=[];
  const resultado=await piloto.processar(evento('preço da panela 6'),{
    nivelAtendimento:async()=> 'IA',
    interpretar:async()=>({intencao:'consulta',produtos:[{termo:'panela 6',quantidade:null}],foto:false,video:false}),
    carregarPerfil:async()=>{throw Error('perfil removido');},
    entregarHumano:async()=>{},
    enviarResposta:async(_tel,msg)=>enviados.push(msg),
    avisarVendedor:async()=>{}
  });
  assert.equal(resultado.acao,'perfil_invalido_transferido');
  assert.doesNotMatch(enviados[0],/R\$/);
});
