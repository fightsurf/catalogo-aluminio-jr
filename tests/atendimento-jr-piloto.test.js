'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const piloto = require('../src/services/whatsapp/atendimento-jr-piloto.service');
const anterior = {
  ATENDIMENTO_JR_PILOTO: process.env.ATENDIMENTO_JR_PILOTO,
  ATENDIMENTO_JR_NUMEROS_TESTE: process.env.ATENDIMENTO_JR_NUMEROS_TESTE,
  ZAPI_WEBHOOK_INSTANCE_ID: process.env.ZAPI_WEBHOOK_INSTANCE_ID
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
test('consulta retorna valor da tabela sem acréscimo ou perfil',()=>{
  assert.equal(piloto.precoTabela(40),40);
  assert.equal(piloto.precoTabela('40,50'),40.5);
  assert.equal(piloto.precoTabela(null),null);
  assert.equal(piloto.precoTabela(''),null);
  assert.equal(piloto.precoTabela(-1),null);
  assert.equal(piloto.precoTabela('invalido'),null);
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
    buscarProdutos:async(itens)=>{consultados.push(itens);return {texto:'Panela 4: R$ 40,00\nPanela 6: R$ 50,00',midias:[]};},
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
test('sem perfil comercial o bot responde com o preço da tabela',async()=>{
  preparar();
  const respostas=[], consultados=[];
  const deps={
    nivelAtendimento:async()=> 'IA',
    interpretar:async()=>({intencao:'consulta',produtos:[{termo:'panela 4',quantidade:null}],foto:false,video:false}),
    buscarProdutos:async(itens)=>{
      consultados.push(itens);
      return {texto:'Panela 4: R$ 40,00',midias:[]};
    },
    enviarResposta:async(_tel,msg)=>respostas.push(msg)
  };
  assert.equal((await piloto.processar(evento('quanto custa a 4'),deps)).acao,'respondeu');
  assert.deepEqual(consultados,[[{termo:'panela 4',quantidade:null}]]);
  assert.deepEqual(respostas,['Panela 4: R$ 40,00']);
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
