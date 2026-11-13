'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const service = fs.readFileSync(
  path.join(__dirname, '../src/services/legado/carradas-progresso/carradas-progresso.service.js'),
  'utf8'
);
const view = fs.readFileSync(
  path.join(__dirname, '../views/legado/carradas/carradas-progresso.html'),
  'utf8'
);

const start = service.indexOf('async function salvarLocalEntrega(');
const end = service.indexOf('async function enviarWhatsappCarradaLote(', start);
assert.ok(start >= 0 && end > start, 'Rotina de salvar local de entrega não localizada');
const salvarLocalEntrega = service.slice(start, end);

test('salvar local de entrega não envia mensagens automáticas para prestadores logísticos', () => {
  assert.doesNotMatch(salvarLocalEntrega, /enviarNotificacaoLocalEntrega\s*\(/);
  assert.doesNotMatch(salvarLocalEntrega, /notificacoesConfig\.carregar\('LOCAL_ENTREGA_(LOGISTICA|AGENCIA)'\)/);
  for (const destinatario of ['Transportadora', 'Redespacho', 'Agencia']) {
    assert.match(salvarLocalEntrega, new RegExp('const notificacao' + destinatario + ' = null;'));
  }
});

test('salvar local de entrega preserva o aviso configurado ao cliente e o cadastro', () => {
  assert.match(salvarLocalEntrega, /faseCodigo:'LOCAL_ENTREGA'/);
  assert.match(salvarLocalEntrega, /const notificacaoCliente=avisoLocalEntrega\.notificacao;/);
  assert.match(salvarLocalEntrega, /INSERT INTO carradas_pedidos_local_entrega/);
});

test('envio manual de romaneios permanece disponível', () => {
  for (const destinatario of ['Transportadora', 'Redespacho', 'Agencia']) {
    assert.ok(view.includes('id="btnEnviarRomaneio' + destinatario + 'Whatsapp"'));
  }
});
