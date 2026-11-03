'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validarCompra } = require('../src/services/compras/comprasValidator');
const basico = () => ({ fornecedor_id:3, numero_nf:' 123 ', valor_nf:205.60, valor_frete:10, icms_frete:1.2,
  quantidade_itens_nf:1, itens:[{descricao:'Disco de alumínio',unidade:'kg',quantidade:2.5,preco_unitario:78.24}] });
test('normaliza e calcula itens', () => {
  const n = validarCompra(basico());
  assert.equal(n.numero_nf, '123');
  assert.equal(n.itens[0].valor_total, 195.6);
  assert.equal(n.itens[0].posicao, 1);
});
test('rejeita nota sem itens e números negativos', () => {
  assert.throws(() => validarCompra({...basico(),itens:[]}), /1 a 500 itens/);
  assert.throws(() => validarCompra({...basico(),valor_frete:-2}), /frete inválido/);
});
test('rejeita valor não numérico ou unidade inválida', () => {
  assert.throws(() => validarCompra({...basico(), valor_nf:'aaa'}), /NF inválido/);
  assert.throws(() => validarCompra({...basico(), itens:[{descricao:'x',unidade:'???',quantidade:1,preco_unitario:10}]}),/Unidade inválida/);
});
