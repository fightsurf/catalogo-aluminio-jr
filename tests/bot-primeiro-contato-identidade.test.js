'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { elegivelBoasVindas } = require('../src/services/bot/bot-identidade.service');

test('não envia boas-vindas ao receber LID em vez de número', () => {
  assert.equal(elegivelBoasVindas('999999999999999@lid'), false);
  assert.equal(elegivelBoasVindas(' 999999999999999@lid '), false);
});

test('não confunde grupos ou identificadores incompletos com telefone', () => {
  assert.equal(elegivelBoasVindas('123456789@group'), false);
  assert.equal(elegivelBoasVindas(''), false);
  assert.equal(elegivelBoasVindas('1234'), false);
});

test('preserva elegibilidade para números comuns de WhatsApp', () => {
  assert.equal(elegivelBoasVindas('5583999999999'), true);
  assert.equal(elegivelBoasVindas('83999999999'), true);
});
