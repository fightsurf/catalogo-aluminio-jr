'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parsear, podeExecutar } = require('../src/services/whatsapp/whatsapp-comandos-jr.service');
const { instanciaAtual } = require('../src/services/whatsapp/zapi-lid-vinculos.service');

test('reconhece somente os seis comandos aprovados', () => {
  for (const comando of ['@preco', '@frete', '@cidades', '@volume', '@kits-hoje', '@kits-ontem']) {
    assert.equal(parsear(comando)?.comando, comando);
  }
  assert.equal(parsear('@lid'), null);
  assert.equal(parsear('@preço panela'), null);
  assert.equal(parsear('texto @frete Fortaleza'), null);
});
test('comandos exigem envio da fábrica, instância correta e conversa individual', () => {
  const instancia = instanciaAtual();
  const dados = { direcao: 'SAIDA', tipo: 'texto' };
  if (!instancia) return; // Em produção a instância é obrigatória.
  const payload = { phone: '5583999999999', fromMe: true, instanceId: instancia };
  assert.equal(podeExecutar(payload, dados), true);
  assert.equal(podeExecutar({ ...payload, fromMe: false }, dados), false);
  assert.equal(podeExecutar({ ...payload, instanceId: 'instancia-externa' }, dados), false);
  assert.equal(podeExecutar({ ...payload, isGroup: true }, dados), false);
  assert.equal(podeExecutar(payload, { ...dados, direcao: 'ENTRADA' }), false);
});
