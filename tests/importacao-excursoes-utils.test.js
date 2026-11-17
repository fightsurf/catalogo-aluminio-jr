'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { chave, telefones, localidade, normalizarLinha, montarCamposTransportadora, classificar } = require('../src/services/logistica/importacaoExcursoesUtils');

test('normaliza acentos e cidade/UF da origem', () => {
  assert.equal(chave('Ilhéus – BA'), 'ilheus ba');
  assert.deepEqual(localidade('São João - RN'), { nome: 'São João', uf: 'RN' });
  assert.equal(localidade('Sem UF'), null);
});
test('extrai telefones sem duplicacao', () => {
  assert.deepEqual(telefones('(83) 99999-0000 / +55 (83) 99999-0000'), ['83999990000']);
});
test('interpreta rota e inclui origem uma vez', () => {
  const linha = normalizarLinha({
    nome: 'Abdon Turismo', origem: 'Ilheus - BA',
    telefone: '(73) 99104-1424',
    rota: 'Ilhéus - BA / Itabuna - BA / Itabuna - BA',
    destino: 'Setor Laranja', tipo: 'excursao'
  });
  assert.equal(linha.nome, 'Abdon Turismo');
  assert.equal(linha.telefones[0], '73991041424');
  assert.equal(linha.cidades.length, 2);
  assert.deepEqual(linha.cidades.map(c => c.uf), ['BA','BA']);
});
test('campos cadastrais usam DDI 55, primeira linha como principal e observacao de origem', () => {
  const linha = normalizarLinha({
    nome: 'Abdon Turismo', origem: 'Ilhéus - BA',
    telefone: '(73) 99104-1424', telefone2: '+55 (73) 99137-1325',
    rota: 'Itabuna - BA / Canavieiras - BA'
  });
  assert.deepEqual(montarCamposTransportadora(linha), {
    nome: 'Abdon Turismo',
    telefone: '5573991041424 / 5573991371325',
    telefone_principal: '5573991041424',
    observacao: 'Origem: Ilhéus - BA'
  });
  assert.deepEqual(linha.cidades.map(c => c.nome), ['Itabuna', 'Canavieiras']);
});

test('nao confunde nomes diferentes e requer revisao de divergencias', () => {
  const existentes = [
    { id: 1, nome: 'Abdon Turismo', telefone: '(73) 99104-1424', telefone_principal: '' },
    { id: 2, nome: 'Adriano Transportes', telefone: '(84) 99861-8929', telefone_principal: '' }
  ];
  assert.equal(classificar(normalizarLinha({ nome:'Abdon Turismo', telefone:'(73) 99104-1424' }), existentes).situacao, 'existente');
  assert.equal(classificar(normalizarLinha({ nome:'Abdon Turismo', telefone:'(73) 99999-9999' }), existentes).situacao, 'revisar');
  assert.equal(classificar(normalizarLinha({ nome:'Adriano Tur' }), existentes).situacao, 'revisar');
  assert.equal(classificar(normalizarLinha({ nome:'Nova Excursao', telefone:'(83) 99999-1111' }), existentes).situacao, 'novo');
});
