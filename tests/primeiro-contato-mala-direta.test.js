'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function carregar(caminho, mocks) {
  const codigo = fs.readFileSync(path.join(__dirname, '..', caminho), 'utf8');
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', codigo)(
    nome => Object.prototype.hasOwnProperty.call(mocks, nome) ? mocks[nome] : require(nome),
    mod, mod.exports
  );
  return mod.exports;
}

const HELPER = 'src/services/bot/primeiro-contato-mala-direta.service.js';
const BOT = 'src/services/bot/botFluxo.services.js';

test('bloqueia saudacao de campanha anterior ao deploy, sem depender do cadastro do bot', async () => {
  const consultas = [];
  const pool = { query: async (sql, parametros) => {
    consultas.push({ sql, parametros });
    return { rows: [{ abordado: true }] };
  }};
  const service = carregar(HELPER, { '../../../db/connection': pool });
  assert.equal(await service.abordadoPelaMalaDireta('5583999991111'), true);
  assert.deepEqual(consultas[0].parametros, [['5583999991111', '558399991111']]);
  assert.match(consultas[0].sql, /mala_direta_destinatarios/);
  assert.match(consultas[0].sql, /etapa_enviada_index/);
  assert.match(consultas[0].sql, /iniciado_envio_em/);
  assert.match(consultas[0].sql, /enviado_em/);
});

test('resposta com 12 digitos bloqueia saudacao para campanha com 13 digitos', async () => {
  const telefoneCampanha = '5583999991111';
  let parametrosDaConsulta;
  const pool = { query: async (sql, params) => {
    assert.match(sql, /telefone = ANY\\(\\$1::varchar\\[\\]\\)/);
    parametrosDaConsulta = params;
    return { rows: [{ abordado: params[0].includes(telefoneCampanha) }] };
  }};
  const service = carregar(HELPER, { '../../../db/connection': pool });
  assert.equal(await service.abordadoPelaMalaDireta('558399991111'), true);
  assert.deepEqual(parametrosDaConsulta, [['558399991111', '5583999991111']]);
});

test('resposta com 13 digitos bloqueia saudacao para campanha com 12 digitos', async () => {
  const telefoneCampanha = '558399991111';
  let parametrosDaConsulta;
  const pool = { query: async (sql, params) => {
    parametrosDaConsulta = params;
    return { rows: [{ abordado: params[0].includes(telefoneCampanha) }] };
  }};
  const service = carregar(HELPER, { '../../../db/connection': pool });
  assert.equal(await service.abordadoPelaMalaDireta('5583999991111'), true);
  assert.deepEqual(parametrosDaConsulta, [['5583999991111', '558399991111']]);
});

test('numeros de DDD diferente nao sao confundidos por sufixo igual', async () => {
  const pool = { query: async (_sql, params) => ({
    rows: [{ abordado: params[0].includes('5584999991111') }]
  }) };
  const service = carregar(HELPER, { '../../../db/connection': pool });
  assert.equal(await service.abordadoPelaMalaDireta('558399991111'), false);
});

test('sem envio anterior, primeira saudacao segue permitida', async () => {
  const pool = { query: async () => ({ rows: [{ abordado: false }] }) };
  const service = carregar(HELPER, { '../../../db/connection': pool });
  assert.equal(await service.abordadoPelaMalaDireta('5583999991111'), false);
});

test('telefone nao canonico nao autoriza saudacao automatica', async () => {
  const pool = { query: async () => { throw Error('Nao deveria consultar'); } };
  const service = carregar(HELPER, { '../../../db/connection': pool });
  assert.equal(await service.abordadoPelaMalaDireta('123@lid'), true);
});

test('marca destinatario no banco do bot antes do primeiro disparo', async () => {
  const consultas = [];
  const client = { query: async (sql, parametros) => consultas.push({ sql, parametros }) };
  const service = carregar(HELPER, { '../../../db/connection': {} });
  await service.registrarEnvioIniciado('5583999991111', client);
  assert.match(consultas[0].sql, /INSERT INTO bot_contatos/);
  assert.match(consultas[0].sql, /ON CONFLICT \(telefone\) DO NOTHING/);
  assert.deepEqual(consultas[0].parametros, ['5583999991111']);
});

function carregarFluxo(abordadoPelaMalaDireta) {
  const chamadas = { zapi: 0, consulta: 0 };
  const pool = { query: async sql => {
    chamadas.consulta++;
    if (/INSERT INTO bot_execucoes_fluxo/.test(sql)) return { rows: [{ id: 1 }] };
    if (/SELECT fluxo_chave/.test(sql)) return { rows: [] };
    if (/FROM bot_acoes/.test(sql)) return { rows: [{
      id: 1, intencao_nome: 'PRIMEIRO_CONTATO', tipo_acao: 'texto',
      conteudo: 'Bem-vindo', ordem: 1, delay_ms: 0
    }] };
    throw Error('Consulta inesperada: ' + sql);
  }};
  const fluxo = carregar(BOT, {
    '../../../db/connection': pool,
    '../integracoes/zapi.service': {
      TIPOS_VALIDOS: ['texto'],
      normalizarTipoAcao: x => x,
      enviarAcao: async () => { chamadas.zapi++; }
    },
    './botAutonomia.services': { getAutonomiaAtiva: async () => true },
    './primeiro-contato-mala-direta.service': { abordadoPelaMalaDireta }
  });
  return { fluxo, chamadas };
}

test('resposta de destinatario da Mala Direta nunca dispara saudacao', async () => {
  const { fluxo, chamadas } = carregarFluxo(async () => true);
  const resultado = await fluxo.executarPrimeiroContatoAutomatico('5583999991111');
  assert.equal(resultado.status, 'saudacao_bloqueada_mala_direta');
  assert.equal(chamadas.zapi, 0);
  assert.equal(chamadas.consulta, 0);
});

test('campanha iniciada durante o fluxo bloqueia saudacao antes da acao', async () => {
  let consultas = 0;
  const { fluxo, chamadas } = carregarFluxo(async () => ++consultas >= 2);
  const resultado = await fluxo.executarPrimeiroContatoAutomatico('5583999991111');
  assert.equal(resultado.status, 'saudacao_bloqueada_mala_direta');
  assert.equal(chamadas.zapi, 0);
  assert.equal(consultas, 2);
});

test('falha ao consultar historico bloqueia saudacao por seguranca', async () => {
  const { fluxo, chamadas } = carregarFluxo(async () => { throw Error('Banco indisponivel'); });
  const resultado = await fluxo.executarPrimeiroContatoAutomatico('5583999991111');
  assert.equal(resultado.status, 'saudacao_bloqueada_mala_direta');
  assert.equal(chamadas.zapi, 0);
});

test('primeiro contato espontaneo ainda recebe saudacao', async () => {
  const { fluxo, chamadas } = carregarFluxo(async () => false);
  const resultado = await fluxo.executarPrimeiroContatoAutomatico('5583999991111');
  assert.equal(resultado.status, 'fluxo_concluido');
  assert.equal(chamadas.zapi, 1);
});

test('Mala Direta registra abordagem antes de liberar o envio pela Z-API', () => {
  const codigo = fs.readFileSync(path.join(__dirname, '../src/services/mala-direta/mala-direta.service.js'), 'utf8');
  const inicio = codigo.indexOf('async function processarProximo()');
  const parteClaim = codigo.slice(inicio, codigo.indexOf('let resultado, erro;', inicio));
  const registro = parteClaim.indexOf('registrarEnvioIniciado(trabalho.telefone, client)');
  const commit = parteClaim.lastIndexOf("await client.query('COMMIT')");
  assert.ok(registro > 0);
  assert.ok(commit > registro, 'registro deve acontecer antes do commit de claim');
});
