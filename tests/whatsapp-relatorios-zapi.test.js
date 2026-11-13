'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../db/connection');
const relatorios = require('../src/services/whatsapp/relatorios-recebidos.service');
const webhook = require('../src/services/whatsapp/zapi-webhook-recebimento.service');

const TEXTO = [
  '📦 RELATÓRIO ALUMÍNIO JR - 2 ITENS ESCOLHIDOS',
  '',
  '• CAFETEIRA | QTD: 2',
  '  UNIT: R$ 20,00',
  '  SUBTOTAL: R$ 40,00',
  '',
  'Valor total: R$ 40,00'
].join('\n');

function evento(extra = {}) {
  return {
    type: 'ReceivedCallback',
    instanceId: 'INSTANCIA_TESTE',
    messageId: 'MENSAGEM_TESTE_1',
    phone: '5583999999999',
    fromMe: false,
    text: { message: TEXTO },
    ...extra
  };
}

test('reconhece somente relatórios Alumínio JR com itens', () => {
  assert.equal(relatorios.ehRelatorioAluminioJR(TEXTO), true);
  assert.equal(relatorios.ehRelatorioAluminioJR('📦 RELATÓRIO ALUMÍNIO JR'), false);
  assert.equal(relatorios.ehRelatorioAluminioJR('• CAFETEIRA | QTD: 2'), false);
});

test('encaminha relatório recebido via Z-API e deduplica pelo evento', async (t) => {
  const queryOriginal = pool.query;
  const queries = [];
  let duplicado = false;

  pool.query = async (sql, params = []) => {
    queries.push({ sql, params });
    if (sql.includes('INSERT INTO whatsapp_relatorios')) {
      return {
        rowCount: duplicado ? 0 : 1,
        rows: duplicado ? [] : [{
          id: 7, telefone: '5583999999999', relatorio: TEXTO
        }]
      };
    }
    return { rowCount: 0, rows: [] };
  };
  t.after(() => { pool.query = queryOriginal; });

  const dados = webhook.normalizarMensagem(evento());
  const primeiro = await webhook.capturarRelatorioRecebido(dados);
  assert.equal(primeiro.salvo, true);
  const insercao = queries.find((item) => item.sql.includes('INSERT INTO whatsapp_relatorios'));
  assert.ok(insercao, 'deve inserir o relatório');
  assert.deepEqual(insercao.params, [
    '5583999999999', TEXTO, 'INSTANCIA_TESTE', 'MENSAGEM_TESTE_1'
  ]);
  assert.match(insercao.sql, /ON CONFLICT/);
  assert.ok(queries.some((item) => item.sql.includes('CREATE UNIQUE INDEX IF NOT EXISTS uq_whatsapp_relatorios_zapi_evento')));

  duplicado = true;
  const repetido = await webhook.capturarRelatorioRecebido(dados);
  assert.deepEqual(repetido, { salvo: false, motivo: 'duplicada' });

  const quantidadeInsercoes = queries.filter((item) => item.sql.includes('INSERT INTO whatsapp_relatorios')).length;
  const propria = await webhook.capturarRelatorioRecebido(
    webhook.normalizarMensagem(evento({ fromMe: true, messageId: 'SAIDA_1' }))
  );
  const comum = await webhook.capturarRelatorioRecebido(
    webhook.normalizarMensagem(evento({ text: { message: 'Bom dia' }, messageId: 'TEXTO_2' }))
  );
  assert.equal(propria.salvo, false);
  assert.equal(comum.salvo, false);
  assert.equal(queries.filter((item) => item.sql.includes('INSERT INTO whatsapp_relatorios')).length, quantidadeInsercoes);
});
