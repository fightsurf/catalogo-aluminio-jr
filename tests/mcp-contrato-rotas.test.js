'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const validacao = require('../src/routes/integracao/mcpValidacao');
const outputSchemas = require('../src/routes/integracao/mcpOutputSchemas');
const protocol = require('../src/routes/integracao/mcpProtocol');

function carregar(file, dependencies, logger = { info() {}, error() {} }) {
  const module = { exports: {} };
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  new Function('require', 'module', 'exports', 'console', source)(name => {
    if (!Object.prototype.hasOwnProperty.call(dependencies, name)) {
      throw new Error('Dependência não simulada: ' + name);
    }
    return dependencies[name];
  }, module, module.exports, logger);
  return module.exports;
}

function routerSimulado() {
  const middlewares = [];
  const routes = new Map();
  const router = { use(fn) { middlewares.push(fn); } };
  for (const method of ['get', 'post', 'delete']) {
    router[method] = (url, fn) => routes.set(method.toUpperCase() + ' ' + url, fn);
  }
  return { router, middlewares, routes };
}

function ambiente() {
  const businessCalls = [];
  const state = { error: null, scopes: 'clientes:read pedidos:write pedidos:manage whatsapp:send logistica:write' };
  const invoke = (name, value) => async (...args) => {
    businessCalls.push({ name, args });
    if (state.error) throw state.error;
    return typeof value === 'function' ? value(...args) : structuredClone(value);
  };
  const registrar = name => invoke(name, {});
  const publicHarness = routerSimulado();
  const publicRouter = carregar('src/routes/integracao/mcpLogistica.routes.js', {
    express: { Router: () => publicHarness.router },
    '../../services/logistica/transportadoraService': {
      listarTransportadoras: invoke('listarTransportadoras', [
        { id: 3, nome: 'Transporte Teste', cidade_nome: 'Patos', cidade_estado: 'PB' }
      ])
    },
    '../../services/logistica/logisticaService': {
      buscarCidadesPorNome: invoke('buscarCidadesPorNome', []),
      listarCidades: invoke('listarCidades', []),
      buscarTransportadorasPorNomeCidade: invoke('buscarTransportadorasPorNomeCidade', { tipo: 'nao_encontrada' })
    },
    './mcpOutputSchemas': outputSchemas,
    './mcpProtocol': protocol
  });
  const acoes = carregar('src/routes/integracao/mcpAcoesPedidosTools.js', {
    '../../services/integracao/mcpAcoesConfirmadas.service': Object.fromEntries(
      ['prepararAcao', 'confirmarAcao', 'consultarAcao'].map(name => [name, registrar(name)])),
    '../../services/integracao/mcpPedidoGestao.service': Object.fromEntries(
      ['prepararAlteracao', 'executarAlteracao', 'prepararCancelamento', 'executarCancelamento',
        'prepararExpedicao', 'executarExpedicao'].map(name => [name, registrar(name)])),
    '../../services/integracao/mcpPedidoWhatsapp.service': {
      prepararEnvio: registrar('prepararEnvio'), executarEnvio: registrar('executarEnvio')
    },
    '../../services/integracao/mcpPagamentosWhatsapp.service': {
      prepararEnvio: registrar('prepararEnvioPagamentos'), executarEnvio: registrar('executarEnvioPagamentos')
    }
  });
  const pedidos = carregar('src/routes/integracao/mcpPedidosTools.js', {
    '../../services/integracao/mcpPedidos.service': Object.fromEntries(
      ['buscarProdutos', 'buscarVendedores', 'prepararPedido', 'confirmarPedido', 'consultarRascunho']
        .map(name => [name, registrar(name)])),
    '../../services/integracao/mcpConsultaPedidos.service': Object.fromEntries(
      ['consultarPedidos', 'detalharPedido', 'buscarCarradas'].map(name => [name, registrar(name)])),
    './mcpAcoesPedidosTools': acoes
  });
  const importacao = carregar('src/routes/integracao/mcpImportacaoCidadesTools.js', {
    '../../services/logistica/importacaoCidades.service': {
      prepararImportacao: registrar('prepararImportacao'), confirmarImportacao: registrar('confirmarImportacao')
    }
  });
  const clientes = { listarClientes: invoke('listarClientes', []) };
  const consultas = carregar('src/services/integracao/mcpConsultasDetalhadas.service.js', {
    '../../../db/connection': { query: registrar('query') },
    '../legado/clientes/clientes.service': clientes
  });
  const authHarness = routerSimulado();
  carregar('src/routes/integracao/mcpClientes.routes.js', {
    express: { Router: () => authHarness.router },
    'node:crypto': require('node:crypto'),
    '../../services/integracao/mcpClientesOAuth.service': {
      enabled: () => true,
      validateAccess: async token => token === 'teste' ? { user: 'conta-teste', scope: state.scopes } : null,
      metadataUrl: () => 'https://example.test/.well-known/oauth-protected-resource'
    },
    '../../services/legado/clientes/clientes.service': clientes,
    './mcpLogistica.routes': publicRouter,
    './mcpPedidosTools': pedidos,
    './mcpImportacaoCidadesTools': importacao,
    './mcpValidacao': validacao,
    './mcpOutputSchemas': outputSchemas,
    './mcpProtocol': protocol,
    '../../services/integracao/mcpConsultasDetalhadas.service': consultas
  });

  async function request(endpoint, { method = 'POST', url = '/', body,
    headers = {}, scopes = state.scopes, pedidosEnabled = true } = {}) {
    state.scopes = scopes;
    const normalized = Object.fromEntries(Object.entries({ authorization: 'Bearer teste', ...headers })
      .map(([key, value]) => [key.toLowerCase(), value]));
    const req = { body, hostname: 'example.test', get: key => normalized[key.toLowerCase()] };
    const res = { statusCode: 200, headers: {}, body: undefined, ended: false,
      status(code) { this.statusCode = code; return this; },
      set(key, value) { this.headers[key] = value; return this; },
      json(value) { this.body = value; this.ended = true; return this; },
      end() { this.ended = true; return this; }
    };
    const harness = endpoint === 'auth' ? authHarness : publicHarness;
    const previous = process.env.MCP_PEDIDOS_ENABLED;
    process.env.MCP_PEDIDOS_ENABLED = String(pedidosEnabled);
    try {
      for (const middleware of harness.middlewares) {
        let next = false;
        await middleware(req, res, () => { next = true; });
        if (!next) return res;
      }
      const route = harness.routes.get(method + ' ' + url);
      assert.equal(typeof route, 'function', 'Rota existe: ' + method + ' ' + url);
      await route(req, res);
      return res;
    } finally {
      if (previous === undefined) delete process.env.MCP_PEDIDOS_ENABLED;
      else process.env.MCP_PEDIDOS_ENABLED = previous;
    }
  }
  return { request, state, businessCalls };
}

const message = (method, params) => ({ jsonrpc: '2.0', id: 5, method, ...(params === undefined ? {} : { params }) });
const init = version => message('initialize', {
  protocolVersion: version, capabilities: {}, clientInfo: { name: 'teste', version: '1.0' }
});
const confirmation = {
  rascunho_id: 'e47ef4e3-e4de-49f7-aeea-c72d8ae0cfa9',
  codigo_confirmacao: '0123456789', confirmacao: 'CONFIRMO'
};

test('ambos endpoints rejeitam protocolo antes de leitura, escrita ou aceite de notificação', async () => {
  const a = ambiente();
  for (const endpoint of ['public', 'auth']) {
    const calls = endpoint === 'auth'
      ? [message('tools/call', { name: 'confirmar_pedido', arguments: confirmation })]
      : [message('tools/call', { name: 'consultar_transportadoras', arguments: {} })];
    calls.push({ jsonrpc: '2.0', method: 'notifications/initialized' });
    for (const body of calls) {
      for (const value of ['2025-11-25', '']) {
        const res = await a.request(endpoint, { body, headers: { 'MCP-Protocol-Version': value } });
        assert.equal(res.statusCode, 400, endpoint + '/' + body.method);
        assert.equal(res.body.error.code, -32602);
        assert.equal(res.body.result, undefined);
      }
    }
  }
  assert.deepEqual(a.businessCalls, []);
});

test('GET e DELETE validam protocolo e continuam sem oferecer stream ou sessão', async () => {
  const a = ambiente();
  for (const endpoint of ['public', 'auth']) {
    for (const method of ['GET', 'DELETE']) {
      const rejected = await a.request(endpoint, { method, headers: { 'MCP-Protocol-Version': '2025-03-26' } });
      assert.equal(rejected.statusCode, 400);
      assert.equal(rejected.body.error.code, -32602);
      for (const headers of [{}, { 'MCP-Protocol-Version': '2025-06-18' }]) {
        const unsupported = await a.request(endpoint, { method, headers });
        assert.equal(unsupported.statusCode, 405);
        assert.equal(unsupported.headers.Allow, 'POST');
        assert.equal(unsupported.body, undefined);
      }
    }
  }
  assert.deepEqual(a.businessCalls, []);
});

test('initialize negocia a revisão implementada e não anuncia notificações inexistentes', async () => {
  const a = ambiente();
  for (const [endpoint, version] of [['public', '0.1.1'], ['auth', '1.5.0']]) {
    for (const requested of ['2025-06-18', '2026-07-28']) {
      const res = await a.request(endpoint, { body: init(requested) });
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.result.protocolVersion, '2025-06-18');
      assert.equal(res.body.result.capabilities.tools.listChanged, false);
      assert.equal(res.body.result.serverInfo.version, version);
    }
    const noId = init('2025-06-18');
    delete noId.id;
    for (const [body, code] of [[message('initialize'), -32602],
      [init('latest'), -32602], [noId, -32600]]) {
      const res = await a.request(endpoint, { body });
      assert.equal(res.statusCode, 400);
      assert.equal(res.body.error.code, code);
      assert.equal(res.body.result, undefined);
    }
  }
  assert.deepEqual(a.businessCalls, []);
});

test('catálogos reais publicam schemas específicos e as três classificações em todas ferramentas', async () => {
  const a = ambiente();
  const catalogs = {};
  for (const [endpoint, total] of [['public', 4], ['auth', 28]]) {
    const res = await a.request(endpoint, { body: message('tools/list') });
    assert.equal(res.statusCode, 200);
    const tools = catalogs[endpoint] = res.body.result.tools;
    assert.equal(tools.length, total);
    assert.equal(new Set(tools.map(t => t.name)).size, total);
    for (const tool of tools) {
      assert.deepEqual(tool.outputSchema, outputSchemas.outputSchemaFor(tool.name));
      assert.equal(tool.outputSchema.type, 'object');
      assert.ok(Object.keys(tool.outputSchema.properties).length > 0);
      for (const annotation of ['readOnlyHint', 'destructiveHint', 'openWorldHint']) {
        assert.equal(typeof tool.annotations[annotation], 'boolean', tool.name + '/' + annotation);
      }
      if (endpoint === 'auth') assert.equal(tool.securitySchemes[0].type, 'oauth2');
      else assert.equal(tool.annotations.readOnlyHint, true);
    }
  }
  for (const tool of catalogs.public) {
    const privateTool = catalogs.auth.find(t => t.name === tool.name);
    assert.deepEqual(privateTool.outputSchema, tool.outputSchema);
    assert.deepEqual(privateTool.annotations, tool.annotations);
  }
  assert.equal(catalogs.auth.find(t => t.name === 'confirmar_pedido').annotations.readOnlyHint, false);
  const send = catalogs.auth.find(t => t.name === 'confirmar_whatsapp_pedido');
  assert.equal(send.annotations.destructiveHint, true);
  assert.equal(send.annotations.openWorldHint, true);
  assert.deepEqual(a.businessCalls, []);
});

test('omissão do header aceita notificações e preserva JSON estruturado e texto de consultas', async () => {
  const a = ambiente();
  for (const endpoint of ['public', 'auth']) {
    const notification = await a.request(endpoint, { body: { jsonrpc: '2.0', method: 'notifications/initialized' } });
    assert.equal(notification.statusCode, 202);
    assert.equal(notification.body, undefined);
    const name = endpoint === 'auth' ? 'buscar_clientes' : 'consultar_transportadoras';
    const args = endpoint === 'auth' ? { nome: 'Teste' } : {};
    const response = await a.request(endpoint, { body: message('tools/call', { name, arguments: args }) });
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.result.isError, false);
    assert.deepEqual(JSON.parse(response.body.result.content[0].text), response.body.result.structuredContent);
    assert.ok(validacao.validar(outputSchemas.outputSchemaFor(name), response.body.result.structuredContent));
  }
  assert.deepEqual(a.businessCalls.map(call => call.name), ['listarTransportadoras', 'listarClientes']);
});

test('falhas de ferramenta permanecem isError sem structuredContent de sucesso', async () => {
  const a = ambiente();
  for (const [endpoint, name, args] of [['public', 'consultar_transportadoras', {}],
    ['auth', 'confirmar_pedido', confirmation]]) {
    a.state.error = new Error('Falha simulada sem garantia de efeito');
    const res = await a.request(endpoint, { body: message('tools/call', { name, arguments: args }),
      headers: { 'MCP-Protocol-Version': '2025-06-18' } });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.result.isError, true);
    assert.equal(Object.hasOwn(res.body.result, 'structuredContent'), false);
    assert.equal(res.body.result.content[0].type, 'text');
    if (endpoint === 'auth') assert.match(res.body.result.content[0].text, /antes de qualquer nova tentativa/);
  }
  assert.deepEqual(a.businessCalls.map(call => call.name), ['listarTransportadoras', 'confirmarPedido']);
});

test('validação de protocolo não elimina autenticação, escopos ou proteção de origem', async () => {
  const a = ambiente();
  const unauthenticated = await a.request('auth', { body: init('2025-06-18'), headers: { authorization: undefined } });
  assert.equal(unauthenticated.statusCode, 401);
  const noWrite = await a.request('auth', {
    body: message('tools/call', { name: 'confirmar_pedido', arguments: confirmation }),
    scopes: 'clientes:read'
  });
  assert.equal(noWrite.body.result.isError, true);
  assert.equal(noWrite.body.result.structuredContent, undefined);
  assert.match(noWrite.body.result._meta['mcp/www_authenticate'][0], /insufficient_scope/);
  const foreignOrigin = await a.request('public', {
    body: message('tools/call', { name: 'consultar_transportadoras', arguments: {} }),
    headers: { origin: 'https://third-party.invalid' }
  });
  assert.equal(foreignOrigin.statusCode, 403);
  assert.deepEqual(a.businessCalls, []);
});
