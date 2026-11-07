'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const admin = require('../src/services/whatsapp/intencoes-admin.service');
const intencoes = [{ id:1, nome:'Localizar cliente', acao:'localizar_cliente', ativo:true,
  frases:'localize cliente\nlocalizar cliente\nprocure cliente\nbusque cliente' }];
test('interpreta comando de voz com ou sem palavra Sistema', () => {
  assert.equal(admin.identificar('Sistema, localize cliente José de Sousa', intencoes).argumento, 'José de Sousa');
  assert.equal(admin.identificar('localize cliente Maria', intencoes).argumento, 'Maria');
  assert.equal(admin.identificar('localizar cliente', intencoes).argumento, '');
  assert.equal(admin.identificar('estou falando com um cliente', intencoes), null);
  assert.equal(admin.identificar('localize cliente Maria', [{...intencoes[0], ativo:false}]), null);
});
test('não executa busca sem autorização', async () => {
  const r = await admin.processarMensagem({telefone:'5583999792085',texto:'localize cliente Maria'});
  assert.equal(r.reconhecido, false);
});
test('consulta e responde somente quando autorizado, sem alterar cadastro', async () => {
  const enviados = []; let nomeBuscado;
  const deps = {
    listarIntencoes: async () => intencoes,
    listarClientes: async nome => { nomeBuscado = nome; return [
      {favorecido:7,nome:'Maria Lima',cidade:'Sousa',uf:'PB'},
      {favorecido:8,nome:'Maria Silva',cidade:'Patos',uf:'PB'} ]; },
    enviar: async ({mensagem}) => enviados.push(mensagem)
  };
  const r = await admin.processarMensagem({
    telefone:'5583999792085',texto:'Sistema, localize cliente Maria',permitido:true
  },deps);
  assert.equal(nomeBuscado,'Maria');
  assert.equal(r.reconhecido,true);
  assert.match(enviados[0],/Maria Lima/);
  assert.match(enviados[0],/Maria Silva/);
});
test('pergunta nome e continua a mesma conversa', async () => {
  const enviados=[]; let buscado='';
  const deps={
    listarIntencoes: async()=>intencoes,
    listarClientes: async nome=>{buscado=nome;return [];},
    enviar:async({mensagem})=>enviados.push(mensagem)
  };
  await admin.processarMensagem({telefone:'5583999792085',texto:'localize cliente',permitido:true},deps);
  assert.match(enviados[0],/Qual é o nome/);
  await admin.processarMensagem({telefone:'5583999792085',texto:'João',permitido:true},deps);
  assert.equal(buscado,'João');
});
