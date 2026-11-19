'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  unirObservacoes, unirTelefones, montarMesclagem, unirCidades, validarEscolhas
} = require('../src/services/logistica/mesclagemTransportadorasUtils');

test('telefones dos dois cadastros são unidos sem repetição, inclusive ramais', () => {
  const destino = { telefone: '(83) 99999-0000 / Ramal 12', telefone_principal: '5583999990000' };
  const origem = { telefone: '5583999990000 / 5583988881111', telefone_principal: '5583988881111' };
  assert.equal(unirTelefones(destino, origem), '5583999990000 / 5583988881111 / Ramal 12');
});

test('nome, cidade e telefone principal podem ser escolhidos independentemente', () => {
  const destino = {
    nome: 'Excursão A', cidade_id: 10,
    telefone: '5583999990000', telefone_principal: '5583999990000',
    observacao: 'Portão 1', contato_principal: 'Maria'
  };
  const origem = {
    nome: 'Excursão B', cidade_id: 20,
    telefone: '5583988881111', telefone_principal: '5583988881111',
    observacao: 'Portão 2', contato_principal: 'João'
  };
  const final = montarMesclagem(destino, origem, {
    nome_de: 'origem', cidade_de: 'destino', principal_de: 'origem'
  });
  assert.equal(final.nome, 'Excursão B');
  assert.equal(final.cidade_id, 10);
  assert.equal(final.telefone_principal, '5583988881111');
  assert.equal(final.telefone, '5583999990000 / 5583988881111');
  assert.equal(final.contato_principal, 'Maria');
  assert.equal(final.observacao, 'Portão 1\nPortão 2\nOutro contato principal (cadastro mesclado): João');
});

test('cidades compartilhadas ficam uma vez com observações preservadas', () => {
  const cidades = [
    { transportadora_id: 1, cidade_id: 10, nome: 'Patos', estado: 'PB', observacao: 'Parada A' },
    { transportadora_id: 1, cidade_id: 20, nome: 'Sousa', estado: 'PB', observacao: null },
    { transportadora_id: 2, cidade_id: 10, nome: 'Patos', estado: 'PB', observacao: 'Parada B' },
    { transportadora_id: 2, cidade_id: 30, nome: 'Caicó', estado: 'RN', observacao: 'Às sextas' }
  ];
  const final = unirCidades(cidades, 1, 2);
  assert.deepEqual(final.map(c => c.cidade_id), [10, 20, 30]);
  assert.equal(final[0].observacao, 'Parada A\nParada B');
  assert.equal(final[2].observacao, 'Às sextas');
});

test('observações idênticas ou com acentos diferentes não se repetem', () => {
  assert.equal(unirObservacoes('Setor Azul\nEntrada Norte', 'setor azul\nEntrada Norte\nSetor Verde'),
    'Setor Azul\nEntrada Norte\nSetor Verde');
});

test('não permite escolhas inválidas', () => {
  assert.throws(() => validarEscolhas({ nome_de:'origem', cidade_de:'qualquer', principal_de:'destino' }), /Escolha/);
});

test('assinatura da prévia não entra nas escolhas da confirmação', () => {
  const escolhas = validarEscolhas({
    destino_id: 1, origem_id: 2, nome_de: 'destino',
    cidade_de: 'origem', principal_de: 'destino',
    assinatura: 'assinatura-da-previa'
  });
  assert.deepEqual(escolhas, {
    nome_de: 'destino', cidade_de: 'origem', principal_de: 'destino'
  });
});

test('telefone principal pode vir do telefone legado da origem', () => {
  const final = montarMesclagem(
    { nome:'A', cidade_id:1, telefone:'5583999990000' },
    { nome:'B', cidade_id:2, telefone:'5583988881111' },
    { nome_de:'destino', cidade_de:'origem', principal_de:'origem' }
  );
  assert.equal(final.telefone_principal, '5583988881111');
});

test('telefone malformatado não perde nem um dígito', () => {
  const unido = unirTelefones(
    { telefone: '5583999990000' },
    { telefone: '5583888881111' } // nove dígitos locais começando em 8: preservar como anotado
  );
  assert.equal(unido, '5583999990000 / 5583888881111');
});
