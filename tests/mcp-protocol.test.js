'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  PROTOCOL_VERSION, SUPPORTED_PROTOCOL_VERSIONS, validateProtocolRequest
} = require('../src/routes/integracao/mcpProtocol');

function initialize(protocolVersion = PROTOCOL_VERSION) {
  return { jsonrpc: '2.0', id: 1, method: 'initialize', params: {
    protocolVersion, capabilities: {}, clientInfo: { name: 'teste', version: '1.0' }
  } };
}

function rejected(result, code = -32602) {
  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.equal(result.code, code);
  assert.equal(typeof result.message, 'string');
  assert.ok(result.message.length > 0);
}

test('negociação preserva a única versão implementada e não modifica a mensagem', () => {
  assert.deepEqual(SUPPORTED_PROTOCOL_VERSIONS, ['2025-06-18']);
  assert.ok(Object.isFrozen(SUPPORTED_PROTOCOL_VERSIONS));
  const request = initialize();
  const snapshot = structuredClone(request);
  for (const header of [undefined, PROTOCOL_VERSION]) {
    assert.deepEqual(validateProtocolRequest(request, header), { ok: true, protocolVersion: PROTOCOL_VERSION });
  }
  assert.deepEqual(request, snapshot);
});

test('initialize negocia uma proposta válida desconhecida sem anunciar suporte a ela', () => {
  for (const version of ['2024-11-05', '2025-03-26', '2025-11-25', '2026-07-28', '2099-12-31']) {
    const result = validateProtocolRequest(initialize(version));
    assert.deepEqual(result, { ok: true, protocolVersion: PROTOCOL_VERSION });
    assert.notEqual(result.protocolVersion, version);
  }
});

test('initialize rejeita parâmetros ausentes, não objetos e versões malformadas', () => {
  for (const params of [undefined, null, [], '', 12, true, {}]) {
    const request = { ...initialize(), params };
    rejected(validateProtocolRequest(request));
  }
  const withoutParams = initialize();
  delete withoutParams.params;
  rejected(validateProtocolRequest(withoutParams));
  for (const version of [undefined, null, 20250618, true, {}, [], '', 'latest', '1.0.0',
    '2025-6-18', '2025-06-18 ', ' 2025-06-18', '2025-02-29', '2025-04-31', '2025-13-01', '2025-00-01']) {
    rejected(validateProtocolRequest({ ...initialize(), params: { protocolVersion: version } }));
  }
  assert.equal(validateProtocolRequest(initialize('2024-02-29')).ok, true);
});

test('initialize exige ID de requisição e não pode passar como notificação', () => {
  const notification = initialize();
  delete notification.id;
  rejected(validateProtocolRequest(notification), -32600);
  for (const id of [null, undefined, false, {}, [], 1.5, Infinity]) {
    rejected(validateProtocolRequest({ ...initialize(), id }), -32600);
  }
  for (const id of [0, -1, 'initialize-1']) {
    assert.equal(validateProtocolRequest({ ...initialize(), id }).ok, true);
  }
});

test('header ausente mantém compatibilidade, sem anunciar 2025-03-26', () => {
  for (const message of [null, undefined,
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { jsonrpc: '2.0', method: 'notifications/initialized' }]) {
    assert.deepEqual(validateProtocolRequest(message), { ok: true, protocolVersion: PROTOCOL_VERSION });
  }
});

test('header inválido, desconhecido, vazio ou múltiplo é rejeitado em todos os despachos', () => {
  const messages = [null, undefined, initialize(),
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'confirmar_pedido' } },
    { jsonrpc: '2.0', id: 3, method: 'ping' },
    { jsonrpc: '2.0', method: 'notifications/initialized' }];
  const headers = [null, '', ' ', 20250618, false, {}, ['2025-06-18'],
    '2025-03-26', '2025-11-25', '2026-07-28', '1.0.0',
    '2025-06-18 ', ' 2025-06-18', '2025-06-18, 2025-06-18'];
  for (const message of messages) {
    for (const header of headers) rejected(validateProtocolRequest(message, header));
  }
});

test('header válido aceita chamadas e notificações e pode validar GET/DELETE sem mensagem', () => {
  for (const message of [null, undefined,
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { jsonrpc: '2.0', method: 'notifications/initialized' }]) {
    assert.deepEqual(validateProtocolRequest(message, PROTOCOL_VERSION), { ok: true, protocolVersion: PROTOCOL_VERSION });
  }
});

test('erro não reproduz conteúdo arbitrário enviado no cabeçalho', () => {
  const hostile = 'segredo-que-nao-deve-ser-devolvido';
  const result = validateProtocolRequest(null, hostile);
  rejected(result);
  assert.ok(!JSON.stringify(result).includes(hostile));
});
