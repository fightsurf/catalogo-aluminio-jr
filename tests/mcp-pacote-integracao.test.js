'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const validacao = require('../src/routes/integracao/mcpValidacao');

function carregar(nome, dependencias) {
  const module = { exports: {} };
  new Function('require', 'module', 'exports', fs.readFileSync(path.join(__dirname, '..', nome), 'utf8'))(name => {
    if (!(name in dependencias)) throw new Error('Dependência não simulada: ' + name);
    return dependencias[name];
  }, module, module.exports);
  return module.exports;
}

function ambiente() {
  const chamadas = [];
  const registrar = name => async (...args) => { chamadas.push({ name, args }); return { status: 'simulado', pedidos: [], payload: {}, resumo: {} }; };
  const gestao = Object.fromEntries(['prepararAlteracao', 'executarAlteracao', 'prepararCancelamento',
    'executarCancelamento', 'prepararExpedicao', 'executarExpedicao'].map(n => [n, registrar(n)]));
  const acoes = carregar('src/routes/integracao/mcpAcoesPedidosTools.js', {
    '../../services/integracao/mcpAcoesConfirmadas.service': {
      prepararAcao: registrar('prepararAcao'), confirmarAcao: registrar('confirmarAcao'), consultarAcao: registrar('consultarAcao') },
    '../../services/integracao/mcpPedidoGestao.service': gestao,
    '../../services/integracao/mcpPedidoWhatsapp.service': { prepararEnvio: registrar('prepararEnvio'), executarEnvio: registrar('executarEnvio') }
  });
  const pedidos = carregar('src/routes/integracao/mcpPedidosTools.js', {
    '../../services/integracao/mcpPedidos.service': Object.fromEntries(['buscarProdutos', 'buscarVendedores', 'prepararPedido', 'confirmarPedido', 'consultarRascunho'].map(n => [n, registrar(n)])),
    '../../services/integracao/mcpConsultaPedidos.service': { consultarPedidos: registrar('consultarPedidos'), detalharPedido: registrar('detalharPedido') },
    './mcpAcoesPedidosTools': acoes
  });
  let middleware, post;
  const router = { use(fn) { middleware = fn; }, get() {}, delete() {}, post(_url, fn) { post = fn; } };
  let scopes = 'clientes:read';
  carregar('src/routes/integracao/mcpClientes.routes.js', {
    express: { Router: () => router },
    '../../services/integracao/mcpClientesOAuth.service': {
      enabled: () => true, metadataUrl: () => 'https://example.test/.well-known/oauth-protected-resource',
      validateAccess: async token => token === 'valido' ? { user: 'conta-autenticada', scope: scopes } : null
    },
    '../../services/legado/clientes/clientes.service': { listarClientes: async () => [] },
    './mcpLogistica.routes': { mcpTools: [], executeTool: registrar('logistica') },
    './mcpPedidosTools': pedidos,
    './mcpValidacao': validacao,
    '../../services/integracao/mcpConsultasDetalhadas.service': {}
  });
  async function requisitar(name, args, scope = 'clientes:read', { token = 'valido', method = 'tools/call' } = {}) {
    scopes = scope;
    const req = { get: () => 'Bearer ' + token,
      body: { jsonrpc: '2.0', id: 1, method, params: { name, arguments: args } } };
    const res = { statusCode: 200, headers: {}, body: undefined,
      set(k, v) { this.headers[k] = v; return this; }, status(v) { this.statusCode = v; return this; },
      json(v) { this.body = v; return this; }, end() { return this; } };
    let permitido = false;
    await middleware(req, res, () => { permitido = true; });
    if (permitido) await post(req, res);
    return res;
  }
  return { requisitar, chamadas, pedidos, acoes };
}
const confirmacao = { acao_id: 'e47ef4e3-e4de-49f7-aeea-c72d8ae0cfa9', codigo_confirmacao: '0123456789ABCDEF', confirmacao: 'CONFIRMO' };

test('catálogo contém consultas e ações individuais, com escopos e metadados coerentes', async () => {
  process.env.MCP_PEDIDOS_ENABLED = 'true';
  const a = ambiente();
  const res = await a.requisitar(null, {}, 'clientes:read', { method: 'tools/list' });
  const tools = res.body.result.tools;
  assert.equal(new Set(tools.map(t => t.name)).size, tools.length);
  assert.ok(tools.some(t => t.name === 'consultar_pedidos'));
  assert.ok(tools.some(t => t.name === 'confirmar_expedicao_pedido'));
  assert.ok(!tools.some(t => /todos|lote|massa/.test(t.name)));
  for (const t of tools.filter(t => a.pedidos.isPedido(t.name))) {
    assert.deepEqual(a.pedidos.requiredScopes(t.name), t.securitySchemes[0].scopes);
    assert.deepEqual(t._meta.securitySchemes, t.securitySchemes);
  }
  for (const name of ['confirmar_alteracao_pedido', 'confirmar_cancelamento_pedido', 'confirmar_expedicao_pedido']) {
    assert.equal(tools.find(t => t.name === name).annotations.destructiveHint, true);
  }
  assert.equal(tools.find(t => t.name === 'confirmar_whatsapp_pedido').annotations.openWorldHint, true);
  assert.deepEqual(a.chamadas, []);
});

test('leitura permite consultar último e sem expedição e não concede nenhuma escrita', async () => {
  const a = ambiente();
  const args = { cliente: 'Eloise Karine', ultimo: true, sem_data_expedicao: true };
  const l = await a.requisitar('consultar_pedidos', args);
  assert.equal(l.body.result.isError, false);
  assert.deepEqual(a.chamadas[0], { name: 'consultarPedidos', args: [args] });
  a.chamadas.length = 0;
  for (const n of ['preparar_alteracao_pedido', 'confirmar_cancelamento_pedido', 'confirmar_expedicao_pedido', 'confirmar_whatsapp_pedido']) {
    const r = await a.requisitar(n, confirmacao);
    assert.equal(r.body.result.isError, true);
    assert.match(r.body.result._meta['mcp/www_authenticate'][0], /insufficient_scope/);
  }
  assert.deepEqual(a.chamadas, []);
});

test('token antigo de criação não autoriza gestão nem avisos novos', async () => {
  const a = ambiente();
  for (const n of ['confirmar_cancelamento_pedido', 'confirmar_whatsapp_pedido', 'confirmar_pedido']) {
    const r = await a.requisitar(n, confirmacao, 'clientes:read pedidos:write');
    assert.equal(r.body.result.isError, true);
  }
  assert.deepEqual(a.chamadas, []);
});

test('gestão e envio são separados e a expedição exige ambos', async () => {
  const a = ambiente();
  const cancel = await a.requisitar('confirmar_cancelamento_pedido', confirmacao, 'clientes:read pedidos:manage');
  assert.equal(cancel.body.result.isError, false);
  assert.equal(a.chamadas[0].args[2], 'cancelar_pedido');
  assert.equal(a.chamadas[0].args[1].usuario, 'conta-autenticada');
  a.chamadas.length = 0;
  const envio = await a.requisitar('confirmar_whatsapp_pedido', confirmacao, 'clientes:read whatsapp:send');
  assert.equal(envio.body.result.isError, false);
  assert.equal(a.chamadas[0].args[2], 'whatsapp_pedido');
  a.chamadas.length = 0;
  for (const s of ['clientes:read pedidos:manage', 'clientes:read whatsapp:send']) {
    const r = await a.requisitar('confirmar_expedicao_pedido', confirmacao, s);
    assert.equal(r.body.result.isError, true);
  }
  assert.deepEqual(a.chamadas, []);
  const exp = await a.requisitar('confirmar_expedicao_pedido', confirmacao, 'clientes:read pedidos:manage whatsapp:send');
  assert.equal(exp.body.result.isError, false);
  assert.equal(a.chamadas[0].args[2], 'expedicao_pedido');
});

test('validação recusa número de pedido como id, destinatário livre e itens incompletos antes dos serviços', async () => {
  const a = ambiente();
  const casos = [
    ['detalhar_pedido', { id_mestre: '0020021' }],
    ['consultar_pedidos', { cliente: 'Eloise', ultimo: 'true' }],
    ['preparar_whatsapp_pedido', { id_mestre: 21, tipo: 'texto', telefone: '5599999999999' }],
    ['preparar_cancelamento_pedido', { id_mestre: 21 }],
    ['preparar_alteracao_pedido', { id_mestre: 21, itens: [{ produto_id: 10, quantidade: 0 }] }],
    ['preparar_alteracao_pedido', { id_mestre: 21, itens: [{ produto_id: 10, quantidade: 1, item: 7 }] }],
    ['confirmar_whatsapp_pedido', { ...confirmacao, confirmacao: 'SIM' }],
    ['consultar_acao_pedido', { acao_id: confirmacao.acao_id, usuario: 'outra-conta' }]
  ];
  for (const [n, args] of casos) {
    const r = await a.requisitar(n, args, 'clientes:read pedidos:write pedidos:manage whatsapp:send');
    assert.equal(r.body.error?.code, -32602, n);
  }
  assert.deepEqual(a.chamadas, []);
});

test('sem OAuth nenhuma ferramenta é acessível e flag desativada não executa pedidos', async () => {
  const a = ambiente();
  const r = await a.requisitar('consultar_pedidos', { cliente: 'Eloise' }, 'clientes:read', { token: 'invalido' });
  assert.equal(r.statusCode, 401);
  assert.deepEqual(a.chamadas, []);
  process.env.MCP_PEDIDOS_ENABLED = 'false';
  try {
    const list = await a.requisitar(null, {}, 'clientes:read', { method: 'tools/list' });
    assert.ok(!list.body.result.tools.some(t => a.pedidos.isPedido(t.name)));
    const chamada = await a.requisitar('consultar_pedidos', { cliente: 'Eloise' });
    assert.equal(chamada.body.result.isError, true);
    assert.deepEqual(a.chamadas, []);
  } finally { process.env.MCP_PEDIDOS_ENABLED = 'true'; }
});
