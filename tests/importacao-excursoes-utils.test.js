'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { chave, telefones, localidade, normalizarLinha, montarCamposTransportadora, combinarTelefones, combinarObservacao, escolherTransportadora, classificar } = require('../src/services/logistica/importacaoExcursoesUtils');

test('normaliza acentos e cidade/UF da origem', () => {
  assert.equal(chave('Ilhéus – BA'), 'ilheus ba');
  assert.deepEqual(localidade('São João - RN'), { nome: 'São João', uf: 'RN' });
  assert.equal(localidade('Sem UF'), null);
});
test('extrai telefones sem duplicacao', () => {
  assert.deepEqual(telefones('(83) 99999-0000 / +55 (83) 99999-0000'), ['83999990000']);
});
test('inclui origem e rota uma vez cada', () => {
  const linha = normalizarLinha({
    nome: 'Abdon Turismo', origem: 'Ilheus - BA',
    telefone: '(73) 99104-1424',
    rota: 'Ilhéus - BA / Itabuna - BA / Itabuna - BA',
    destino: 'Setor Laranja', tipo: 'excursao'
  });
  assert.equal(linha.nome, 'Abdon Turismo');
  assert.equal(linha.telefones[0], '73991041424');
  assert.equal(linha.cidades.length, 3);
  assert.deepEqual(linha.cidades.map(c => c.uf), ['BA','BA','BA']);
});
test('campos cadastrais usam DDI 55, primeira linha como principal e observacao de origem', () => {
  const linha = normalizarLinha({
    nome: 'Abdon Turismo', origem: 'Ilhéus - BA',
    telefone: '(73) 99104-1424', telefone2: '+55 (73) 99137-1325',
    rota: 'Itabuna - BA / Canavieiras - BA', destino:'Estacionamento Azul'
  });
  assert.deepEqual(montarCamposTransportadora(linha), {
    nome: 'Abdon Turismo',
    telefone: '5573991041424 / 5573991371325',
    telefone_principal: '5573991041424',
    observacao: 'Estacionamento Azul'
  });
  assert.deepEqual(linha.cidades.map(c => c.nome), ['Ilhéus', 'Itabuna', 'Canavieiras']);
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

test('cadastro de cidade pelo nome completo do estado e deduplicacao', () => {
  const linha = normalizarLinha({
    nome:'Olivença Tour', origem:'Olivença Bahia',
    rota:'Olivença - BA / Ilhéus Bahia / Ilhéus - BA'
  });
  assert.deepEqual(linha.cidades, [
    { nome:'Olivença', uf:'BA' },
    { nome:'Ilhéus', uf:'BA' }
  ]);
});
test('atualizar sem apagar telefones e observacoes', () => {
  const r = combinarTelefones({
    telefone:'(73) 99104-1424 / Ramal interno',
    telefone_principal:'5573991041424'
  }, ['73991041424', '73991371325', '73991371325']);
  assert.equal(r.telefone, '(73) 99104-1424 / Ramal interno / 5573991371325');
  assert.equal(r.telefone_principal, '5573991041424');
  assert.equal(r.adicionados, 1);
  assert.equal(combinarObservacao('Portão Norte', 'Setor Azul'), 'Portão Norte\nSetor Azul');
  assert.equal(combinarObservacao('Setor Azul', 'Setor Azul'), 'Setor Azul');
});
test('associar automaticamente somente a cadastro com correspondencia unica', () => {
  const item = normalizarLinha({ nome:'Abdon Turismo', telefone:'(73) 99104-1424' });
  const existentes = [
    { id:1, nome:'Abdon Turismo', telefone:'5573991041424' },
    { id:2, nome:'Abdon Entregas', telefone:'5573991000000' }
  ];
  assert.equal(escolherTransportadora(item, existentes).id, 1);
  assert.equal(escolherTransportadora(item, [
    { id:1, nome:'Abdon Turismo', telefone:'5573991041424' },
    { id:3, nome:'Abdon Turismo', telefone:'5573991041424' }
  ]), null);
});
