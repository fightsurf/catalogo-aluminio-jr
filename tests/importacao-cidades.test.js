'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function carregar(arquivo, dependencias) {
  const modulo = { exports: {} };
  const fonte = fs.readFileSync(path.join(__dirname, '..', arquivo), 'utf8');
  new Function('require', 'module', 'exports', fonte)(nome => {
    if (!(nome in dependencias)) throw new Error('Dependência não simulada: ' + nome);
    return dependencias[nome];
  }, modulo, modulo.exports);
  return modulo.exports;
}

function ambiente() {
  const transportadoras = new Map([[110, { id: 110, nome: 'Odair' }]]);
  const cidades = new Map([
    [1, { id: 1, nome: 'Catolé do Rocha', estado: 'PB', codigo_ibge: '2504303' }],
    [2, { id: 2, nome: 'Brejo do Cruz', estado: 'PB', codigo_ibge: 2502802 }],
    [3, { id: 3, nome: 'Cidade legada', estado: 'PB', codigo_ibge: null }],
    [4, { id: 4, nome: 'São José', estado: 'SC', codigo_ibge: '4216602' }],
    [5, { id: 5, nome: 'São José', estado: 'PI', codigo_ibge: '2209978' }]
  ]);
  const vinculos = new Map([
    ['110:1', { transportadora_id: 110, cidade_id: 1, observacao: 'Coleta toda terça' }],
    ['110:4', { transportadora_id: 110, cidade_id: 4, observacao: 'Vínculo fora desta importação' }]
  ]);
  const consultas = [];
  const estatisticas = { conexoes: 0, liberacoes: 0, insercoes: 0, falharNaInsercao: 0 };
  let snapshot;
  async function query(sql, valores = []) {
    const s = sql.replace(/\s+/g, ' ').trim();
    consultas.push({ sql: s, valores });
    if (s === 'BEGIN') { snapshot = structuredClone(vinculos); return { rows: [] }; }
    if (s === 'COMMIT') { snapshot = undefined; return { rows: [] }; }
    if (s === 'ROLLBACK') {
      if (snapshot) { vinculos.clear(); for (const [k, v] of snapshot) vinculos.set(k, v); }
      snapshot = undefined;
      return { rows: [] };
    }
    if (s.startsWith('SELECT id, nome FROM transportadoras WHERE id = $1')) {
      const row = transportadoras.get(valores[0]);
      return { rows: row ? [{ ...row }] : [] };
    }
    if (s.startsWith('SELECT id, codigo_ibge, nome, estado FROM cidades')) {
      const rows = [...cidades.values()].filter(c => !s.includes('ANY(') || valores[0].includes(c.id));
      return { rows: rows.map(c => ({ ...c })) };
    }
    if (s === 'SELECT id FROM cidades WHERE codigo_ibge = $1') {
      return { rows: [...cidades.values()].filter(c => String(c.codigo_ibge) === String(valores[0])).map(c => ({ id: c.id })) };
    }
    if (s.startsWith('SELECT cidade_id FROM transportadora_cidade')) {
      return { rows: [...vinculos.values()].filter(v => v.transportadora_id === valores[0]).map(v => ({ cidade_id: v.cidade_id })) };
    }
    if (s.startsWith('SELECT COUNT(*)::integer AS total FROM transportadora_cidade')) {
      return { rows: [{ total: [...vinculos.values()].filter(v => v.transportadora_id === valores[0]).length }] };
    }
    if (s.startsWith('INSERT INTO transportadora_cidade')) {
      estatisticas.insercoes++;
      if (estatisticas.insercoes === estatisticas.falharNaInsercao) throw new Error('Falha simulada no banco');
      assert.ok(transportadoras.has(valores[0]) && cidades.has(valores[1]), 'chaves estrangeiras válidas');
      const key = valores[0] + ':' + valores[1];
      if (vinculos.has(key) && s.includes('DO NOTHING')) return { rows: [], rowCount: 0 };
      const row = { transportadora_id: valores[0], cidade_id: valores[1], observacao: valores[2] };
      vinculos.set(key, row);
      return { rows: [{ ...row }], rowCount: 1 };
    }
    if (s === 'DELETE FROM transportadora_cidade WHERE transportadora_id = $1 AND cidade_id = $2') {
      return { rows: [], rowCount: vinculos.delete(valores[0] + ':' + valores[1]) ? 1 : 0 };
    }
    throw new Error('Consulta não prevista no teste: ' + s);
  }
  const pool = {
    query,
    async connect() {
      estatisticas.conexoes++;
      return { query, release() { estatisticas.liberacoes++; } };
    }
  };
  const logistica = carregar('src/services/logistica/logisticaService.js', { '../../../db/connection': pool });
  const service = carregar('src/services/logistica/importacaoCidades.service.js', {
    'node:crypto': crypto,
    '../../../db/connection': pool,
    './importacaoExcursoesUtils': require('../src/services/logistica/importacaoExcursoesUtils'),
    './logisticaService': logistica
  });
  return { service, logistica, transportadoras, cidades, vinculos, consultas, estatisticas };
}

const conta = { usuario: 'administrador-teste' };
const lista = [
  { nome: 'Catolé do Rocha', uf: 'PB' },
  { nome: 'Brejo do Cruz', uf: 'PB' },
  { nome: 'Cidade legada', uf: 'PB' }
];
async function previa(a, cidades = lista) {
  return a.service.prepararImportacao({ transportadora_id: 110, cidades }, conta);
}
const segredoAnterior = process.env.ADMIN_SESSION_SECRET;
test.before(() => { process.env.ADMIN_SESSION_SECRET = 'segredo-exclusivo-dos-testes-importacao-cidades'; });
test.after(() => {
  if (segredoAnterior === undefined) delete process.env.ADMIN_SESSION_SECRET;
  else process.env.ADMIN_SESSION_SECRET = segredoAnterior;
});

test('prévia resolve acentos, usa cidades legadas sem IBGE e deduplica sem gravar', async () => {
  const a = ambiente();
  const p = await previa(a, [
    { nome: 'catole do rocha', uf: 'pb' },
    { nome: 'CATOLÉ DO ROCHA', uf: 'PB', codigo_ibge: '2504303' },
    { nome: 'Brejo do Cruz', uf: 'PB', codigo_ibge: 2502802 },
    { nome: 'Brejo do Cruz', uf: 'PB', codigo_ibge: 2502802 },
    { nome: 'Cidade legada', uf: 'PB' }
  ]);
  assert.deepEqual(p.transportadora, { id: 110, nome: 'Odair' });
  assert.deepEqual(p.resumo, { informadas: 5, novas: 2, ja_vinculadas: 1, repetidas: 2, pendentes: 0 });
  assert.deepEqual(p.cidades.map(c => [c.nome, c.situacao]), [
    ['Catolé do Rocha', 'ja_vinculada'], ['Brejo do Cruz', 'nova'], ['Cidade legada', 'nova']
  ]);
  assert.equal(p.cidades[2].codigo_ibge, null);
  assert.equal(p.pode_confirmar, true);
  assert.ok(p.token_previa && Date.parse(p.expira_em) > Date.now());
  assert.ok(a.consultas.every(c => c.sql.startsWith('SELECT')));
  assert.equal(a.estatisticas.conexoes, 0);
  assert.equal(a.vinculos.size, 2);
});

test('UF ausente/inválida e cidade desconhecida viram pendências sem inferir pela transportadora', async () => {
  const a = ambiente();
  const p = await previa(a, [
    { nome: 'São José', uf: '' },
    { nome: 'Brejo do Cruz', uf: 'XX' },
    { nome: 'Brejo do Cruz', uf: 'Paraíba' },
    { nome: 'Cidade que não existe', uf: 'PB' },
    { nome: 'Brejo do Cruz', uf: 'PB' }
  ]);
  assert.equal(p.resumo.pendentes, 4);
  assert.equal(p.cidades.length, 1);
  assert.equal(p.pode_confirmar, false);
  assert.equal(p.token_previa, null);
  assert.equal(p.expira_em, null);
  assert.match(p.pendencias[0].motivo, /UF/);
  assert.equal(a.estatisticas.insercoes, 0);
});

test('código IBGE fornecido precisa corresponder ao nome e UF, inclusive para cidade legada', async () => {
  const a = ambiente();
  const p = await previa(a, [
    { nome: 'Brejo do Cruz', uf: 'PB', codigo_ibge: '2504303' },
    { nome: 'Cidade legada', uf: 'PB', codigo_ibge: '9999999' },
    { nome: 'Catolé do Rocha', uf: 'PB', codigo_ibge: '123' }
  ]);
  assert.equal(p.pendencias.length, 3);
  assert.equal(p.cidades.length, 0);
  assert.equal(p.pode_confirmar, false);
  assert.match(p.pendencias[0].motivo, /não corresponde/);
  assert.match(p.pendencias[2].motivo, /sete dígitos/);
});

test('cadastros homônimos na mesma UF exigem resolução inequívoca', async () => {
  const a = ambiente();
  a.cidades.set(9, { id: 9, nome: 'Brejo do Cruz', estado: 'PB', codigo_ibge: null });
  const ambiguo = await previa(a, [{ nome: 'Brejo do Cruz', uf: 'PB' }]);
  assert.equal(ambiguo.pode_confirmar, false);
  assert.match(ambiguo.pendencias[0].motivo, /Mais de um cadastro/);
  const resolvido = await previa(a, [{ nome: 'Brejo do Cruz', uf: 'PB', codigo_ibge: '2502802' }]);
  assert.equal(resolvido.pode_confirmar, true);
  assert.equal(resolvido.cidades[0].cidade_id, 2);
});

test('confirmação acrescenta o lote, preserva observações e vínculos fora da lista', async () => {
  const a = ambiente();
  const p = await previa(a);
  const r = await a.service.confirmarImportacao({ token_previa: p.token_previa, transportadora_id: 110 }, conta);
  assert.deepEqual(r, { status: 'concluido', transportadora: { id: 110, nome: 'Odair' },
    adicionadas: 2, ja_vinculadas: 1, total_vinculadas: 4 });
  assert.equal(a.vinculos.get('110:1').observacao, 'Coleta toda terça');
  assert.equal(a.vinculos.get('110:4').observacao, 'Vínculo fora desta importação');
  assert.equal(a.vinculos.get('110:3').cidade_id, 3);
  assert.equal(a.estatisticas.liberacoes, 1);
  assert.equal(a.consultas.at(-1).sql, 'COMMIT');
});

test('repetir a confirmação é aditivo e não duplica os vínculos', async () => {
  const a = ambiente();
  const p = await previa(a);
  await a.service.confirmarImportacao({ token_previa: p.token_previa }, conta);
  const novamente = await a.service.confirmarImportacao({ token_previa: p.token_previa }, conta);
  assert.equal(novamente.adicionadas, 0);
  assert.equal(novamente.ja_vinculadas, 3);
  assert.equal(novamente.total_vinculadas, 4);
  assert.equal(a.vinculos.size, 4);
});

test('vínculo acrescentado depois da prévia é preservado e contado como já vinculado', async () => {
  const a = ambiente();
  const p = await previa(a);
  a.vinculos.set('110:2', { transportadora_id: 110, cidade_id: 2, observacao: 'Observação posterior à prévia' });
  const r = await a.service.confirmarImportacao({ token_previa: p.token_previa }, conta);
  assert.equal(r.adicionadas, 1);
  assert.equal(r.ja_vinculadas, 2);
  assert.equal(a.vinculos.get('110:2').observacao, 'Observação posterior à prévia');
});

test('token alterado, truncado, exagerado, de outra conta ou outro alvo não acessa o banco', async () => {
  const a = ambiente();
  const p = await previa(a);
  const alterado = p.token_previa.slice(0, -1) + (p.token_previa.endsWith('0') ? '1' : '0');
  for (const token of [alterado, p.token_previa.slice(0, -6), 'a'.repeat(128 * 1024 + 1), null]) {
    await assert.rejects(a.service.confirmarImportacao({ token_previa: token }, conta), e => e.isValidation && e.status === 409);
  }
  await assert.rejects(a.service.confirmarImportacao({ token_previa: p.token_previa }, { usuario: 'outro-admin' }), e => e.status === 403);
  await assert.rejects(a.service.confirmarImportacao({ token_previa: p.token_previa, transportadora_id: 111 }, conta), e => e.status === 409);
  assert.equal(a.estatisticas.conexoes, 0);
});

test('prévia vencida é rejeitada antes de conectar', async () => {
  const a = ambiente();
  const p = await previa(a);
  const now = Date.now;
  Date.now = () => Date.parse(p.expira_em);
  try {
    await assert.rejects(a.service.confirmarImportacao({ token_previa: p.token_previa }, conta), e => e.status === 409);
    assert.equal(a.estatisticas.conexoes, 0);
  } finally { Date.now = now; }
});

test('mudanças no nome, UF, IBGE ou exclusão da cidade invalidam a prévia sem gravar', async () => {
  for (const mudar of [
    a => { a.cidades.get(2).nome = 'Outro município'; },
    a => { a.cidades.get(2).estado = 'RN'; },
    a => { a.cidades.get(2).codigo_ibge = '9999999'; },
    a => { a.cidades.delete(2); }
  ]) {
    const a = ambiente();
    const p = await previa(a);
    mudar(a);
    await assert.rejects(a.service.confirmarImportacao({ token_previa: p.token_previa }, conta), e => e.isValidation && e.status === 409);
    assert.equal(a.vinculos.size, 2);
    assert.equal(a.estatisticas.insercoes, 0);
    assert.equal(a.consultas.at(-1).sql, 'ROLLBACK');
    assert.equal(a.estatisticas.liberacoes, 1);
  }
});

test('transportadora renomeada ou excluída invalida a prévia', async () => {
  for (const excluir of [false, true]) {
    const a = ambiente();
    const p = await previa(a);
    if (excluir) a.transportadoras.delete(110);
    else a.transportadoras.get(110).nome = 'Outra transportadora';
    await assert.rejects(a.service.confirmarImportacao({ token_previa: p.token_previa }, conta), e => e.status === 409);
    assert.equal(a.estatisticas.insercoes, 0);
    assert.equal(a.consultas.at(-1).sql, 'ROLLBACK');
  }
});

test('falha no meio do lote desfaz todas as inserções da transação', async () => {
  const a = ambiente();
  const p = await previa(a, [lista[1], lista[2]]);
  a.estatisticas.falharNaInsercao = 2;
  await assert.rejects(a.service.confirmarImportacao({ token_previa: p.token_previa }, conta), /Falha simulada/);
  assert.equal(a.vinculos.size, 2);
  assert.equal(a.vinculos.has('110:2'), false);
  assert.equal(a.consultas.at(-1).sql, 'ROLLBACK');
  assert.equal(a.estatisticas.liberacoes, 1);
});

test('códigos inválidos, lote excessivo, campos longos e ausência de conta falham antes das consultas', async () => {
  const a = ambiente();
  for (const payload of [
    { transportadora_id: '110', cidades: lista },
    { transportadora_id: -1, cidades: lista },
    { transportadora_id: 110, cidades: [] },
    { transportadora_id: 110, cidades: Array(301).fill(lista[0]) },
    { transportadora_id: 110, cidades: [{ nome: 'x'.repeat(121), uf: 'PB' }] },
    { transportadora_id: 110, cidades: [{ nome: 'Brejo do Cruz', uf: { sigla: 'PB' } }] }
  ]) {
    await assert.rejects(a.service.prepararImportacao(payload, conta), e => e.isValidation && e.status === 400);
  }
  await assert.rejects(a.service.prepararImportacao({ transportadora_id: 110, cidades: lista }), e => e.status === 401);
  assert.equal(a.consultas.length, 0);
});

test('edição manual mantém atualização de observação após extração da rotina compartilhada', async () => {
  const a = ambiente();
  await a.logistica.vincularCidade(110, '2504303', 'Novo horário manual');
  assert.equal(a.vinculos.get('110:1').observacao, 'Novo horário manual');
  await a.logistica.vincularCidadePorId(110, 1, null, { preservarExistente: true });
  assert.equal(a.vinculos.get('110:1').observacao, 'Novo horário manual');
  await assert.rejects(a.logistica.vincularCidade(110, '0000000', ''), /Cidade nao encontrada/);
});

test('remoção por ID permite gerenciar cidade sem IBGE e respeita a transportadora', async () => {
  const a = ambiente();
  a.vinculos.set('110:3', { transportadora_id: 110, cidade_id: 3, observacao: null });
  a.vinculos.set('111:3', { transportadora_id: 111, cidade_id: 3, observacao: 'Outra transportadora' });
  await a.logistica.removerCidadePorId(110, 3);
  assert.equal(a.vinculos.has('110:3'), false);
  assert.equal(a.vinculos.has('111:3'), true);
  assert.equal(a.vinculos.has('110:1'), true);
});
