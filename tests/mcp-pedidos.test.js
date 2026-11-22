'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function criarAmbiente() {
  const source = fs.readFileSync(
    path.join(__dirname, '../src/services/integracao/mcpPedidos.service.js'), 'utf8'
  );
  const drafts = new Map();
  let gravacoes = 0;
  let precoAtual = 25;
  const produto = () => ({
    id: 10, nome: 'Panela 3 litros', preco: precoAtual, item_legado: 99,
    ativo: true, perfil_orcamento: true, perfil_kit_feirinha: false
  });
  const pool = {
    async query(sql, params = []) {
      if (sql.includes('CREATE TABLE IF NOT EXISTS')) return { rows: [] };
      if (sql.includes('INSERT INTO mcp_pedidos_rascunhos')) {
        drafts.set(params[0], {
          id: params[0], codigo_hash: params[1],
          payload: JSON.parse(params[2]), resumo: JSON.parse(params[3]),
          status: 'aguardando_confirmacao', expira_em: new Date(Date.now() + 900000)
        });
        return { rows: [] };
      }
      if (sql.includes('SET status = \'em_processamento\'')) {
        const d = drafts.get(params[0]);
        if (!d || d.codigo_hash !== params[1] || d.status !== 'aguardando_confirmacao') return { rows: [] };
        d.status = 'em_processamento';
        return { rows: [{ payload: d.payload }] };
      }
      if (sql.includes('SELECT id, status, resumo')) {
        const d = drafts.get(params[0]);
        return { rows: d ? [d] : [] };
      }
      if (sql.includes("SET status='confirmado'")) {
        const d = drafts.get(params[0]);
        d.status = 'confirmado';
        d.pedido_resultado = JSON.parse(params[1]);
        d.confirmado_em = new Date();
        return { rows: [] };
      }
      if (sql.includes("status='revisao_necessaria'")) {
        drafts.get(params[0]).status = 'revisao_necessaria';
        return { rows: [] };
      }
      throw new Error('SQL inesperado: ' + sql.slice(0, 60));
    }
  };
  const clientes = {
    listarClientes: async () => [{ favorecido: 7, nome: 'Cliente JR', cidade: 'Patos', uf: 'PB' }],
    buscarCliente: async id => id === 7 ? { favorecido: 7, nome: 'Cliente JR' } : null
  };
  const vendedores = { buscarVendedor: async id => id === 9 ? { favorecido: 9, nome: 'Vendedor JR' } : null };
  const produtos = { listar: async () => [produto()], buscar: async id => id === 10 ? produto() : null };
  const pedidos = { inserirPedido: async payload => {
    gravacoes++;
    assert.equal(payload.total, 50);
    return { pedido: { numero: '12345', total: 50 } };
  } };
  const fakeRequire = name => {
    if (name === 'crypto') return crypto;
    if (name === '../../../db/connection') return pool;
    if (name.endsWith('clientes.service')) return clientes;
    if (name.endsWith('vendedores.service')) return vendedores;
    if (name.endsWith('produto.service')) return produtos;
    if (name.endsWith('pedidos-insercao-v2.service')) return pedidos;
    throw new Error('Dependência inesperada: ' + name);
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', source)(fakeRequire, module, module.exports);
  return {
    service: module.exports,
    getGravacoes: () => gravacoes,
    alterarPreco: novo => { precoAtual = novo; }
  };
}

function dadosBase() {
  return {
    favorecido: 7, vendedor: 9, itens: [{ produto_id: 10, quantidade: 2 }]
  };
}

test('consulta e preparação não gravam pedido no Firebird', async () => {
  const t = criarAmbiente();
  const clientes = await t.service.buscarClientes({ nome: 'cliente' });
  assert.equal(clientes.clientes[0].favorecido, 7);
  const preparado = await t.service.prepararPedido(dadosBase());
  assert.equal(preparado.status, 'aguardando_confirmacao');
  assert.equal(preparado.resumo.total, 50);
  assert.equal(t.getGravacoes(), 0);
});

test('exige confirmação, grava uma vez e protege contra repetição', async () => {
  const t = criarAmbiente();
  const draft = await t.service.prepararPedido(dadosBase());
  await assert.rejects(() => t.service.confirmarPedido({
    rascunho_id: draft.rascunho_id,
    codigo_confirmacao: draft.codigo_confirmacao,
    confirmacao: 'SIM'
  }), /CONFIRMO/);
  const data = {
    rascunho_id: draft.rascunho_id,
    codigo_confirmacao: draft.codigo_confirmacao,
    confirmacao: 'CONFIRMO'
  };
  const result = await t.service.confirmarPedido(data);
  assert.equal(result.status, 'confirmado');
  assert.equal(result.numero_pedido, '12345');
  const duplicate = await t.service.confirmarPedido(data);
  assert.equal(duplicate.status, 'confirmado');
  assert.equal(t.getGravacoes(), 1);
});

test('bloqueia preços inferiores ao cadastro', async () => {
  const t = criarAmbiente();
  await assert.rejects(() => t.service.prepararPedido({
    ...dadosBase(), itens: [{ produto_id: 10, quantidade: 2, preco: 20 }]
  }), /abaixo da referência/);
  assert.equal(t.getGravacoes(), 0);
});

test('preço alterado depois da prévia impede gravação', async () => {
  const t = criarAmbiente();
  const draft = await t.service.prepararPedido(dadosBase());
  t.alterarPreco(30);
  const result = await t.service.confirmarPedido({
    rascunho_id: draft.rascunho_id,
    codigo_confirmacao: draft.codigo_confirmacao,
    confirmacao: 'CONFIRMO'
  });
  assert.equal(result.status, 'revisao_necessaria');
  assert.equal(t.getGravacoes(), 0);
});
