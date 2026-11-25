'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function preparar() {
  const consultas = [];
  const alteracoes = [];
  const registro = {
    id: 17,
    favorecido: 123,
    cliente_nome_snapshot: 'Cliente de teste',
    data_lancamento: '2026-11-25',
    tipo: 'DIVIDA_AVULSA',
    descricao: 'Compra feita no balcão',
    origem_tipo: 'DIVIDA_MANUAL',
    numero_pedido: null,
    valor_debito: 125.50,
    valor_credito: 0,
    observacao: null
  };
  const dbClient = {
    async query(sql, params = []) {
      alteracoes.push({ sql, params });
      if (/SELECT \*/.test(sql)) return { rows: [{ ...registro }] };
      if (/UPDATE cliente_credito_lancamentos/.test(sql)) {
        return { rows: [{ ...registro, data_lancamento: params[0], descricao: params[1], valor_debito: params[2], valor_credito: params[3], observacao: params[4] }] };
      }
      return { rows: [] };
    },
    release() {}
  };
  const pool = {
    async query(sql, params = []) {
      consultas.push({ sql, params });
      if (/INSERT INTO cliente_credito_lancamentos/.test(sql)) {
        return { rows: [{
          ...registro,
          favorecido: params[0],
          cliente_nome_snapshot: params[1],
          data_lancamento: params[2],
          descricao: params[3],
          valor_debito: params[4],
          observacao: params[5]
        }] };
      }
      return { rows: [] };
    },
    async connect() { return dbClient; }
  };
  const arquivo = fs.readFileSync(path.resolve(__dirname, '../src/services/legado/clientes-creditos/clientes-creditos.service.js'), 'utf8');
  const modulo = { exports: {} };
  new Function('require', 'module', 'exports', arquivo)(nome => {
    if (nome === '../../../../db/connection') return pool;
    if (nome === '../legadoBridge.service') return { put: async () => { throw new Error('Não deve acessar o financeiro legado ao editar dívida manual.'); } };
    throw new Error('Dependência inesperada: ' + nome);
  }, modulo, modulo.exports);
  const service = modulo.exports;
  service._ensureSchema = async () => {};
  service._buscarNomeClienteSnapshot = async () => 'Cliente de teste';
  return { service, consultas, alteracoes, registro, pool };
}

test('registra dívida avulsa como débito, sem pedido nem pagamento legado', async () => {
  const { service, consultas } = preparar();
  const salvo = await service.registrarDividaAvulsa(123, {
    valor: '125,50', dataLancamento: '2026-11-25',
    descricao: '  Compra feita no balcão ', observacao: '  Sem pedido  '
  });
  assert.equal(salvo.tipo, 'DIVIDA_AVULSA');
  assert.equal(salvo.origem_tipo, 'DIVIDA_MANUAL');
  assert.equal(salvo.numero_pedido, null);
  assert.equal(salvo.valorDebito, 125.5);
  assert.equal(salvo.valorCredito, 0);
  assert.equal(consultas.length, 1);
  assert.match(consultas[0].sql, /'DIVIDA_AVULSA'.*'DIVIDA_MANUAL'/s);
  assert.deepEqual(consultas[0].params, [123, 'Cliente de teste', '2026-11-25', 'Compra feita no balcão', 125.5, 'Sem pedido']);
});

test('recusa dívida sem valor positivo, sem descrição ou com data inválida', async () => {
  const { service, consultas } = preparar();
  const base = { valor: '12,50', dataLancamento: '2026-11-25', descricao: 'Compra avulsa' };
  await assert.rejects(service.registrarDividaAvulsa(123, { ...base, valor: '0' }), /valor válido/);
  await assert.rejects(service.registrarDividaAvulsa(123, { ...base, valor: '-10' }), /valor válido/);
  await assert.rejects(service.registrarDividaAvulsa(123, { ...base, descricao: '   ' }), /descrição da dívida/);
  await assert.rejects(service.registrarDividaAvulsa(123, { ...base, dataLancamento: '2026-02-30' }), /data válida/);
  assert.equal(consultas.length, 0);
});

test('permite alterar dívida avulsa sem criar crédito', async () => {
  const { service, alteracoes } = preparar();
  const atualizado = await service.atualizarLancamento(123, 17, {
    dataLancamento: '2026-11-26', descricao: 'Compra balcão revisada', valor: '150,00'
  });
  assert.equal(atualizado.valorDebito, 150);
  assert.equal(atualizado.valorCredito, 0);
  assert.equal(atualizado.tipo, 'DIVIDA_AVULSA');
  assert.ok(alteracoes.some(x => /UPDATE cliente_credito_lancamentos/.test(x.sql)));
});

test('extrato contém botão ao lado de Registrar pagamento e modal de dívida funcional', () => {
  const html = fs.readFileSync(path.resolve(__dirname, '../views/legado/clientes-creditos/clientes-creditos-extrato.html'), 'utf8');
  assert.match(html, /type="submit">Registrar pagamento<\/button>\s*<button id="btnRegistrarDivida"/);
  assert.match(html, /id="formDivida"/);
  assert.match(html, /id="descricaoDivida"[^>]+required/);
  assert.match(html, /\/dividas/);
  const script = html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(script, 'Script da página ausente');
  assert.doesNotThrow(() => new vm.Script(script[1]));
});


test('extrato exibe movimentações recentes primeiro sem alterar o saldo histórico', async () => {
  const { service, pool } = preparar();
  const movimentos = [
    { id: 1, favorecido: 123, cliente_nome_snapshot: 'Cliente de teste', data_lancamento: '2026-11-20', tipo: 'AJUSTE_DEBITO', valor_debito: 100, valor_credito: 0 },
    { id: 2, favorecido: 123, cliente_nome_snapshot: 'Cliente de teste', data_lancamento: '2026-11-24', tipo: 'PAGAMENTO_CLIENTE', valor_debito: 0, valor_credito: 30 },
    { id: 3, favorecido: 123, cliente_nome_snapshot: 'Cliente de teste', data_lancamento: '2026-11-24', tipo: 'DIVIDA_AVULSA', valor_debito: 50, valor_credito: 0 }
  ];
  pool.query = async sql => {
    assert.match(sql, /ORDER BY data_lancamento ASC, id ASC/);
    return { rows: movimentos };
  };

  const extrato = await service.buscarExtrato(123);
  assert.deepEqual(extrato.lancamentos.map(movimento => movimento.id), [3, 2, 1]);
  assert.deepEqual(extrato.lancamentos.map(movimento => movimento.saldo), [120, 70, 100]);
  assert.equal(extrato.resumo.saldo, 120);
  assert.equal(extrato.resumo.totalDebito, 150);
  assert.equal(extrato.resumo.totalCredito, 30);
});
