const test = require('node:test');
const assert = require('node:assert/strict');
const { validarPagamentoEditavel, validarAtualizacaoPagamento } = require('../src/services/prestacao_contas/prestacao-pagamentos-validacao');

test('permite modificar data, valor e observação de pagamento comum', () => {
 const x = validarAtualizacaoPagamento({data:'2026-10-31', valor:'150.25', observacao:'  Conferido  '});
 assert.deepEqual(x, {data:'2026-10-31',valor:150.25,observacao:'Conferido'});
 assert.doesNotThrow(() => validarPagamentoEditavel({id:1, origem_sistema:null, credito_origem_id:null}));
});
test('não aceita datas impossíveis, valores inválidos e frações de centavos', () => {
 for (const data of ['2026-02-30','2026-13-10','31/10/2026','','2026-10-00']) {
   assert.throws(() => validarAtualizacaoPagamento({data,valor:10}));
 }
 for (const valor of [0,-1,'','abc',10.001]) {
   assert.throws(() => validarAtualizacaoPagamento({data:'2026-10-31',valor}));
 }
});
test('bloqueia edição direta de créditos automáticos e pagamentos de pedidos', () => {
 for (const pagamento of [null,{credito_origem_id:3},{origem_sistema:'PEDIDO_LEGADO'},
   {origem_sistema:'PEDIDO_LEGADO_DISTRIBUICAO'},{origem_pagamento_codigo:33}]) {
   assert.throws(() => validarPagamentoEditavel(pagamento));
 }
});
