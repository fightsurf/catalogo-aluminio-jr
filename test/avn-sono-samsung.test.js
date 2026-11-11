'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const parseNight = require('../src/routes/avn/avn-sono-mobile.routes')._parseNight;

const valid = () => ({
  external_id: 'samsung-night-01',
  inicio: '2026-11-10T23:00:00Z',
  fim: '2026-11-11T07:00:00Z',
  duracao_min: 430,
  pontuacao: 83,
  sessoes_quantidade: 1,
  estagios: [
    {tipo: 'LIGHT', inicio: '2026-11-10T23:00:00Z', fim: '2026-11-11T01:00:00Z'},
    {tipo: 'DEEP', inicio: '2026-11-11T01:00:00Z', fim: '2026-11-11T02:00:00Z'},
    {tipo: 'REM', inicio: '2026-11-11T02:00:00Z', fim: '2026-11-11T03:00:00Z'},
    {tipo: 'AWAKE', inicio: '2026-11-11T03:00:00Z', fim: '2026-11-11T03:20:00Z'},
  ],
});
test('normaliza uma noite Samsung com fases ordenadas', () => {
  const result = parseNight(valid());
  assert.equal(result.id, 'samsung-night-01');
  assert.equal(result.score, 83);
  assert.equal(result.stages.length, 4);
  assert.equal(result.stages[0].tipo, 'LIGHT');
  assert.equal(result.start.toISOString(), '2026-11-10T23:00:00.000Z');
});
test('rejeita identificador vazio e identificador longo', () => {
  assert.throws(() => parseNight({...valid(), external_id: '   '}), /Identificador/);
  assert.throws(() => parseNight({...valid(), external_id: 'x'.repeat(241)}), /Identificador/);
});
test('rejeita pontuação inválida e período invertido', () => {
  assert.throws(() => parseNight({...valid(), pontuacao: 101}), /Pontuação/);
  assert.throws(() => parseNight({...valid(), fim: '2026-11-10T22:00:00Z'}), /Período/);
});
test('rejeita fase desconhecida ou fora dos limites', () => {
  const unknown = valid();
  unknown.estagios[0].tipo = 'NREM99';
  assert.throws(() => parseNight(unknown), /Tipo de fase/);
  const outside = valid();
  outside.estagios[0].fim = '2026-11-11T09:00:00Z';
  assert.throws(() => parseNight(outside), /fora da noite/);
});
test('aceita duração e pontuação ausentes', () => {
  const sample = valid();
  sample.duracao_min = null;
  sample.pontuacao = null;
  const result = parseNight(sample);
  assert.equal(result.duration, null);
  assert.equal(result.score, null);
});
