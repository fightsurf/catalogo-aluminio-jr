'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validarCompra } = require('../src/services/compras/comprasValidator');
const basico = () => ({fornecedor_id:3, numero_nf:' 000123 ',valor_nf:205.60,valor_frete:10,icms_frete:1.2,
  quantidade_itens_nf:1,itens:[{descricao:'Disco de alumínio',unidade:'kg',quantidade:2.5,preco_unitario:78.24}]});
test('permite apenas fornecedor e número de NF, sem insumos',()=>{
  const n = validarCompra({fornecedor_id:3,numero_nf:' 0010 '});
  assert.equal(n.numero_nf,'0010');
  assert.equal(n.valor_nf,null);
  assert.equal(n.valor_frete,null);
  assert.equal(n.icms_frete,null);
  assert.equal(n.quantidade_itens_nf,null);
  assert.deepEqual(n.itens,[]);
});
test('calcula total das linhas conhecidas',()=>{
  const n=validarCompra(basico());
  assert.equal(n.numero_nf,'000123');
  assert.equal(n.itens[0].valor_total,195.6);
});
test('armazena linha parcial para conferência posterior',()=>{
  const n=validarCompra({fornecedor_id:1,numero_nf:'2',itens:[{descricao:'Alumínio',unidade:'kg',quantidade:4}]});
  assert.equal(n.itens[0].preco_unitario,null);
  assert.equal(n.itens[0].valor_total,null);
});
test('somente fornecedor e número são obrigatórios',()=>{
  assert.throws(()=>validarCompra({numero_nf:'123'}),/Fornecedor é obrigatório/);
  assert.throws(()=>validarCompra({fornecedor_id:1}),/Número da nota fiscal é obrigatório/);
});
test('rejeita valores monetários negativos e unidades inválidas',()=>{
  assert.throws(()=>validarCompra({...basico(),valor_frete:-2}),/frete inválido/);
  assert.throws(()=>validarCompra({...basico(),itens:[{descricao:'x',unidade:'???',quantidade:1}]}),/Unidade inválida/);
});
