'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ehLid, limparTelefone, extrairLid, instanciaAtual
} = require('../src/services/whatsapp/zapi-lid-vinculos.service');

test('LID e numero real sao identificadores diferentes', () => {
  assert.equal(ehLid('123456789012@lid'), true);
  assert.equal(ehLid('5511999999999'), false);
  assert.equal(limparTelefone('5511999999999'), '5511999999999');
  assert.equal(limparTelefone('123456789012@lid'), '');
});

test('preferir chatLid e nao inferir contato pelo conteudo', () => {
  assert.equal(extrairLid({
    chatLid: '9876543210@lid',
    senderLid: '1111111111@lid',
    fromMe: true
  }), '9876543210@lid');
  assert.equal(extrairLid({ senderLid: '1111111111@lid', fromMe: true }), '');
  assert.equal(extrairLid({ senderLid: '2222222222@lid', fromMe: false }), '2222222222@lid');
  assert.equal(extrairLid({ phone: '5511999999999', fromMe: false }), '');
});

test('identifica instancia usando somente configuracao confiavel', () => {
  const antes = {
    ZAPI_WEBHOOK_INSTANCE_ID: process.env.ZAPI_WEBHOOK_INSTANCE_ID,
    ZAPI_URL: process.env.ZAPI_URL
  };
  try {
    delete process.env.ZAPI_WEBHOOK_INSTANCE_ID;
    process.env.ZAPI_URL = 'https://api.z-api.io/instances/INSTANCIA_TESTE/token/SEGREDO';
    assert.equal(instanciaAtual(), 'INSTANCIA_TESTE');
    process.env.ZAPI_WEBHOOK_INSTANCE_ID = 'INSTANCIA_EXPLICITA';
    assert.equal(instanciaAtual(), 'INSTANCIA_EXPLICITA');
  } finally {
    for (const [nome, valor] of Object.entries(antes)) {
      if (valor === undefined) delete process.env[nome];
      else process.env[nome] = valor;
    }
  }
});
