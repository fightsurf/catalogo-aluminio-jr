'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizarMensagem } =
  require('../src/services/whatsapp/zapi-webhook-recebimento.service');

function evento(extra = {}) {
  return {
    type: 'ReceivedCallback',
    instanceId: 'INSTANCIA_TESTE',
    messageId: 'MENSAGEM_123',
    phone: '123456789@lid',
    fromMe: false,
    text: { message: ' @frete Natal ' },
    ...extra
  };
}

test('aceita texto da Z-API e preserva identificador @lid', () => {
  const dados = normalizarMensagem(evento());
  assert.equal(dados.telefone, '123456789@lid');
  assert.equal(dados.mensagem, '@frete Natal');
  assert.equal(dados.tipo, 'texto');
  assert.equal(dados.direcao, 'ENTRADA');
  assert.equal(dados.instancia, 'INSTANCIA_TESTE');
  assert.equal(dados.messageId, 'MENSAGEM_123');
});

test('reconhece mídia sem executar transcrição ou automações', () => {
  const dados = normalizarMensagem(evento({ text: undefined, audio: { audioUrl: 'https://example.com/audio' } }));
  assert.equal(dados.tipo, 'audio');
  assert.equal(dados.mensagem, 'Áudio recebido');
});

test('registra comandos digitados pelo próprio número como saída', () => {
  const dados = normalizarMensagem(evento({
    fromMe: true,
    messageId: 'MENSAGEM_PROPRIA_1',
    text: { message: '@frete Fortaleza - CE' }
  }));
  assert.equal(dados.direcao, 'SAIDA');
  assert.equal(dados.mensagem, '@frete Fortaleza - CE');
  assert.equal(dados.messageId, 'MENSAGEM_PROPRIA_1');
});

test('ignora quando não sabemos se a mensagem é própria ou recebida', () => {
  assert.equal(normalizarMensagem(evento({ fromMe: undefined })).ignorar, 'origem_nao_informada');
});

test('ignora outros webhooks e notificações', () => {
  assert.equal(normalizarMensagem(evento({ type: 'DeliveryCallback' })).ignorar, 'outro_evento');
  assert.equal(normalizarMensagem(evento({ notification: 'PROFILE_NAME_UPDATED' })).ignorar, 'evento_nao_conversacional');
});

test('não registra mensagens sem identificador único', () => {
  assert.equal(normalizarMensagem(evento({ messageId: '' })).ignorar, 'identificacao_incompleta');
});
