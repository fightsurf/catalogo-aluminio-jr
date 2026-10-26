const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizarRespostaIA } = require('../src/services/prestacao_contas/prestacaoNotaIa.service');
const prestacoes = require('../src/services/prestacao_contas/prestacao_contas.service');

test('interpreta KG e UN e preserva preço unitário', () => {
  const dados = normalizarRespostaIA({
    itens: [
      { material: 'Alumínio 6060', quantidade: '1.250,500', unidade: 'KG', preco_unitario: '12,30' },
      { material: 'Panela', quantidade: 8, unidade: 'UN', preco_unitario: 25.5 }
    ], avisos: []
  });
  assert.equal(dados.itens[0].quantidade, 1250.5);
  assert.equal(dados.itens[0].preco_unitario, 12.3);
  assert.equal(dados.itens[1].unidade, 'UN');
  assert.deepEqual(dados.itens[1].alertas, []);
});

test('não inventa valores ilegíveis; destaca divergência de subtotal', () => {
  const dados = normalizarRespostaIA({
    itens: [
      { material: 'Produto A', quantidade: null, unidade: null, preco_unitario: null },
      { material: 'Produto B', quantidade: 3, unidade: 'UN', preco_unitario: 10, subtotal_informado: 35 }
    ], avisos: ['Foto pouco nítida']
  });
  assert.equal(dados.itens[0].quantidade, null);
  assert.equal(dados.itens[0].preco_unitario, null);
  assert.ok(dados.itens[0].alertas.length > 0);
  assert.ok(dados.itens[1].alertas.some(x => x.includes('Subtotal impresso')));
  assert.equal(dados.avisos.length, 1);
});

test('valida quantidade inteira para UN e exige preço', () => {
  assert.equal(prestacoes._validarItemMaterial({
    material: 'Produto', peso_kg: 2, preco_por_kg: 5.5, unidade: 'UN'
  }).unidade, 'UN');
  assert.throws(() => prestacoes._validarItemMaterial({
    material: 'Produto', peso_kg: 1.5, preco_por_kg: 5.5, unidade: 'UN'
  }), /inteira/);
  assert.throws(() => prestacoes._validarItemMaterial({
    material: 'Produto', peso_kg: 2, preco_por_kg: null, unidade: 'KG'
  }), /obrigatórios/);
});
