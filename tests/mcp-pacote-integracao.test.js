'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const validacao = require('../src/routes/integracao/mcpValidacao');
const outputSchemas = require('../src/routes/integracao/mcpOutputSchemas');
const protocol = require('../src/routes/integracao/mcpProtocol');

function carregar(nome, dependencias, logger = console) {
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'console', fs.readFileSync(path.join(__dirname, '..', nome), 'utf8'))(name => {
    if (!(name in dependencias)) throw new Error('Dependência não simulada: ' + name);
    return dependencias[name];
  }, module, module.exports, logger);
  return module.exports;
}

function ambiente({ authEnabled = true, authError = null, listarClientesMock = async () => [] } = {}) {
  const chamadas = [];
  const logs = [];
  const registrar = name => async (...args) => { chamadas.push({ name, args }); return { status: 'simulado', pedidos: [], payload: {}, resumo: {} }; };
  const gestao = Object.fromEntries(['prepararAlteracao', 'executarAlteracao', 'prepararCancelamento',
    'executarCancelamento', 'prepararExpedicao', 'executarExpedicao'].map(n => [n, registrar(n)]));
  const acoes = carregar('src/routes/integracao/mcpAcoesPedidosTools.js', {
    '../../services/integracao/mcpAcoesConfirmadas.service': {
      prepararAcao: registrar('prepararAcao'), confirmarAcao: registrar('confirmarAcao'), consultarAcao: registrar('consultarAcao') },
    '../../services/integracao/mcpPedidoGestao.service': gestao,
    '../../services/integracao/mcpPedidoWhatsapp.service': { prepararEnvio: registrar('prepararEnvio'), executarEnvio: registrar('executarEnvio') },
    '../../services/integracao/mcpPagamentosWhatsapp.service': { prepararEnvio: registrar('prepararEnvioPagamentos'), executarEnvio: registrar('executarEnvioPagamentos') }
  });
  const pedidos = carregar('src/routes/integracao/mcpPedidosTools.js', {
    '../../services/integracao/mcpPedidos.service': Object.fromEntries(['buscarProdutos', 'buscarVendedores', 'prepararPedido', 'confirmarPedido', 'consultarRascunho'].map(n => [n, registrar(n)])),
    '../../services/integracao/mcpConsultaPedidos.service': { consultarPedidos: registrar('consultarPedidos'), detalharPedido: registrar('detalharPedido'), buscarCarradas: registrar('buscarCarradas') },
    './mcpAcoesPedidosTools': acoes
  });
  const importacao = carregar('src/routes/integracao/mcpImportacaoCidadesTools.js', {
    '../../services/logistica/importacaoCidades.service': {
      prepararImportacao: registrar('prepararImportacao'), confirmarImportacao: registrar('confirmarImportacao')
    }
  });
  let middleware, post;
  const router = { use(fn) { middleware = fn; }, get() {}, delete() {}, post(_url, fn) { post = fn; } };
  let scopes = 'clientes:read';
  carregar('src/routes/integracao/mcpClientes.routes.js', {
    express: { Router: () => router },
    'node:crypto': require('node:crypto'),
    '../../services/integracao/mcpClientesOAuth.service': {
      enabled: () => authEnabled, metadataUrl: () => 'https://example.test/.well-known/oauth-protected-resource',
      validateAccess: async token => {
        if (authError) throw authError;
        return token === 'valido' ? { user: 'conta-autenticada', scope: scopes } : null;
      }
    },
    '../../services/legado/clientes/clientes.service': { listarClientes: listarClientesMock },
    './mcpLogistica.routes': { mcpTools: [], executeTool: registrar('logistica') },
    './mcpPedidosTools': pedidos,
    './mcpImportacaoCidadesTools': importacao,
    './mcpValidacao': validacao,
    './mcpOutputSchemas': outputSchemas,
    './mcpProtocol': protocol,
    '../../services/integracao/mcpConsultasDetalhadas.service': { resumirCliente: c => ({ favorecido: c.favorecido, nome: c.nome, cidade: c.cidade || null, uf: c.uf || null, telefone: null, observacao: null }) }
  }, { info: (...args) => logs.push(args), error: (...args) => logs.push(args) });
  async function requisitar(name, args, scope = 'clientes:read', { token = 'valido', method = 'tools/call' } = {}) {
    scopes = scope;
    const params = method === 'initialize'
      ? { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'teste', version: '1' } }
      : { name, arguments: args };
    const req = { get: header => header.toLowerCase() === 'authorization' && token !== null ? 'Bearer ' + token : undefined,
      body: { jsonrpc: '2.0', id: 1, method, params } };
    const res = { statusCode: 200, headers: {}, body: undefined,
      set(k, v) { this.headers[k] = v; return this; }, status(v) { this.statusCode = v; return this; },
      json(v) { this.body = v; return this; }, end() { return this; } };
    let permitido = false;
    await middleware(req, res, () => { permitido = true; });
    if (permitido) await post(req, res);
    return res;
  }
  return { requisitar, chamadas, logs, pedidos, acoes, importacao };
}
const confirmacao = { acao_id: 'e47ef4e3-e4de-49f7-aeea-c72d8ae0cfa9', codigo_confirmacao: '0123456789ABCDEF', confirmacao: 'CONFIRMO' };
const confirmacaoPedido = { rascunho_id: 'e47ef4e3-e4de-49f7-aeea-c72d8ae0cfa9', codigo_confirmacao: '0123456789', confirmacao: 'CONFIRMO' };

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
  for (const name of ['confirmar_alteracao_pedido', 'confirmar_cancelamento_pedido', 'confirmar_expedicao_pedido', 'confirmar_whatsapp_pedido']) {
    assert.equal(tools.find(t => t.name === name).annotations.destructiveHint, true);
  }
  assert.equal(tools.find(t => t.name === 'confirmar_whatsapp_pedido').annotations.openWorldHint, true);
  const criar = tools.find(t => t.name === 'confirmar_pedido');
  assert.equal(criar.annotations.readOnlyHint, false);
  assert.equal(criar.annotations.openWorldHint, false);
  assert.deepEqual(criar.securitySchemes[0].scopes, ['clientes:read', 'pedidos:write']);
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

test('permissão de criação grava sem autorizar gestão ou WhatsApp', async () => {
  const a = ambiente();
  for (const n of ['confirmar_cancelamento_pedido', 'confirmar_whatsapp_pedido']) {
    const r = await a.requisitar(n, confirmacao, 'clientes:read pedidos:write');
    assert.equal(r.body.result.isError, true);
  }
  assert.deepEqual(a.chamadas, []);
  const r = await a.requisitar('confirmar_pedido', confirmacaoPedido, 'clientes:read pedidos:write');
  assert.equal(r.body.result.isError, false);
  assert.equal(a.chamadas.length, 1);
  assert.equal(a.chamadas[0].name, 'confirmarPedido');
  const semEscrita = await a.requisitar('confirmar_pedido', confirmacaoPedido, 'clientes:read whatsapp:send');
  assert.equal(semEscrita.body.result.isError, true);
  assert.equal(a.chamadas.length, 1);
});

test('aviso de carrada usa a preparação de WhatsApp e exige permissão de envio', async () => {
  const a = ambiente();
  const args = { id_mestre: 21, tipo: 'aviso_carrada' };
  const bloqueado = await a.requisitar('preparar_whatsapp_pedido', args, 'clientes:read pedidos:write');
  assert.equal(bloqueado.body.result.isError, true);
  assert.deepEqual(a.chamadas, []);
  const permitido = await a.requisitar('preparar_whatsapp_pedido', args, 'clientes:read whatsapp:send');
  assert.equal(permitido.body.result.isError, false);
  assert.equal(a.chamadas[0].name, 'prepararEnvio');
  assert.deepEqual(a.chamadas[0].args[0], args);
  assert.equal(a.chamadas[1].name, 'prepararAcao');
  assert.ok(!a.chamadas.some(c => c.name === 'executarEnvio'));
});

test('auditoria distingue chegada e escopo sem registrar dados ou códigos de confirmação', async () => {
  const a = ambiente();
  const negado = await a.requisitar('confirmar_pedido', confirmacaoPedido, 'clientes:read');
  assert.equal(negado.body.result.isError, true);
  const eventos = a.logs.map(l => JSON.parse(l[1]));
  assert.deepEqual(eventos.map(e => e.etapa), ['recebida', 'escopo_insuficiente']);
  assert.ok(eventos.every(e => e.ferramenta === 'confirmar_pedido' && e.versao === '1.5.0'));
  assert.equal(eventos[0].rastreio, eventos[1].rastreio);
  assert.equal(negado.body.result._meta['aluminiojr/rastreio'], eventos[0].rastreio);
  assert.equal(negado.headers['X-MCP-Rastreio'], eventos[0].rastreio);
  assert.equal(negado.headers['X-MCP-Versao'], '1.5.0');
  assert.match(negado.body.result._meta['mcp/www_authenticate'][0], /error="insufficient_scope"/);
  assert.match(negado.body.result._meta['mcp/www_authenticate'][0], /error_description="This action requires additional OAuth scopes\."/);
  const serializado = JSON.stringify(a.logs);
  for (const segredo of [confirmacaoPedido.rascunho_id, confirmacaoPedido.codigo_confirmacao, 'conta-autenticada', 'Bearer valido']) {
    assert.ok(!serializado.includes(segredo));
  }
});

test('recusas OAuth antes da ferramenta têm rastreio sem divulgar credenciais ou argumentos', async () => {
  const a = ambiente();
  const tokenPrivado = 'token-que-nao-pode-aparecer';
  const args = { cliente: 'Cliente privado', observacao: 'Observação privada', ...confirmacaoPedido };
  const respostas = [];
  for (const token of [null, tokenPrivado]) {
    const resposta = await a.requisitar('confirmar_pedido', args, 'clientes:read pedidos:write', { token });
    respostas.push(resposta);
    assert.equal(resposta.statusCode, 401);
    assert.match(resposta.headers['WWW-Authenticate'], /resource_metadata=/);
    assert.match(resposta.headers['WWW-Authenticate'], /scope="clientes:read"/);
    const evento = JSON.parse(a.logs.at(-1)[1]);
    assert.deepEqual(evento, {
      versao: '1.5.0', ferramenta: null, rastreio: resposta.headers['X-MCP-Rastreio'], etapa: 'autenticacao_necessaria'
    });
    assert.deepEqual(resposta.body._meta, {
      'aluminiojr/versao': '1.5.0', 'aluminiojr/rastreio': evento.rastreio
    });
    assert.match(evento.rastreio, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i);
  }
  assert.notEqual(respostas[0].headers['X-MCP-Rastreio'], respostas[1].headers['X-MCP-Rastreio']);
  assert.equal(a.logs.length, 2);
  assert.deepEqual(a.chamadas, []);
  const diagnostico = JSON.stringify({ logs: a.logs, respostas: respostas.map(r => r.body) });
  for (const privado of [tokenPrivado, args.cliente, args.observacao, args.rascunho_id, args.codigo_confirmacao]) {
    assert.ok(!diagnostico.includes(privado));
  }
});

test('indisponibilidade e erro OAuth são distintos sem registrar mensagem arbitrária da falha', async () => {
  const erroPrivado = new Error('Falha no banco com token-privado, conta-privada e telefone-privado');
  for (const [authEnabled, etapa, mensagem] of [
    [false, 'servico_desativado', 'MCP de clientes desativado.'],
    [true, 'autenticacao_indisponivel', 'Falha temporária na autenticação.']
  ]) {
    const a = ambiente({ authEnabled, authError: erroPrivado });
    const resposta = await a.requisitar('confirmar_pedido', confirmacaoPedido, 'clientes:read pedidos:write');
    assert.equal(resposta.statusCode, 503);
    assert.equal(resposta.body.erro, mensagem);
    assert.deepEqual(a.chamadas, []);
    assert.equal(a.logs.length, 1);
    const evento = JSON.parse(a.logs[0][1]);
    assert.deepEqual(evento, {
      versao: '1.5.0', ferramenta: null, rastreio: resposta.headers['X-MCP-Rastreio'], etapa
    });
    assert.equal(resposta.body._meta['aluminiojr/rastreio'], evento.rastreio);
    assert.equal(resposta.body._meta['aluminiojr/versao'], '1.5.0');
    assert.equal(resposta.headers['WWW-Authenticate'], undefined);
    const diagnostico = JSON.stringify({ logs: a.logs, resposta: resposta.body });
    for (const privado of [erroPrivado.message, 'token-privado', 'conta-privada', 'telefone-privado', confirmacaoPedido.codigo_confirmacao]) {
      assert.ok(!diagnostico.includes(privado));
    }
  }
});

test('mesmo rastreio acompanha sucesso da ferramenta e versão anunciada na inicialização', async () => {
  const a = ambiente();
  const inicio = await a.requisitar(null, {}, 'clientes:read', { method: 'initialize' });
  assert.equal(inicio.body.result.serverInfo.version, '1.5.0');
  assert.equal(inicio.headers['X-MCP-Versao'], '1.5.0');
  const resposta = await a.requisitar('consultar_pedidos', { numero: '0020001' });
  assert.equal(resposta.body.result.isError, false);
  const eventos = a.logs.map(l => JSON.parse(l[1]));
  assert.deepEqual(eventos.map(e => e.etapa), ['recebida', 'concluida']);
  assert.ok(eventos.every(e => e.rastreio === resposta.headers['X-MCP-Rastreio']));
  assert.equal(resposta.body.result._meta['aluminiojr/rastreio'], resposta.headers['X-MCP-Rastreio']);
  assert.notEqual(inicio.headers['X-MCP-Rastreio'], resposta.headers['X-MCP-Rastreio']);
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

test('buscar carradas aparece no catálogo como leitura e usa a consulta existente', async () => {
  process.env.MCP_PEDIDOS_ENABLED = 'true';
  const a = ambiente();
  const list = await a.requisitar(null, {}, 'clientes:read', { method: 'tools/list' });
  const ferramenta = list.body.result.tools.find(t => t.name === 'buscar_carradas');
  assert.ok(ferramenta);
  assert.deepEqual(ferramenta.securitySchemes, [{ type: 'oauth2', scopes: ['clientes:read'] }]);
  assert.deepEqual(ferramenta._meta.securitySchemes, ferramenta.securitySchemes);
  assert.equal(ferramenta.annotations.readOnlyHint, true);
  assert.equal(ferramenta.annotations.destructiveHint, false);
  assert.equal(a.pedidos.requiresWrite('buscar_carradas'), false);
  const args = { data: '2026-12-02', descricao: 'São José', pagina: 2, limite: 1 };
  const res = await a.requisitar('buscar_carradas', args);
  assert.equal(res.body.result.isError, false);
  assert.deepEqual(a.chamadas, [{ name: 'buscarCarradas', args: [args] }]);
});

test('buscar carradas recusa argumentos incompletos ou tipos incorretos antes do serviço', async () => {
  const a = ambiente();
  for (const args of [
    {}, { data: 20261202 }, { data: null },
    { data: '2026-12-02', descricao: 12 },
    { data: '2026-12-02', limite: 0 }, { data: '2026-12-02', limite: 31 },
    { data: '2026-12-02', pagina: 0 }, { data: '2026-12-02', pagina: '2' },
    { data: '2026-12-02', descricao: 'a'.repeat(121) },
    { data: '2026-12-02', carrada_codigo: 1697 }
  ]) {
    const r = await a.requisitar('buscar_carradas', args);
    assert.equal(r.body.error?.code, -32602, JSON.stringify(args));
  }
  assert.deepEqual(a.chamadas, []);
});

test('buscar carradas exige OAuth e escopo de leitura sem conceder gravação', async () => {
  const a = ambiente();
  const args = { data: '2026-12-02' };
  const semToken = await a.requisitar('buscar_carradas', args, 'clientes:read', { token: 'invalido' });
  assert.equal(semToken.statusCode, 401);
  const semLeitura = await a.requisitar('buscar_carradas', args, 'pedidos:write');
  assert.equal(semLeitura.body.result.isError, true);
  assert.match(semLeitura.body.result._meta['mcp/www_authenticate'][0], /insufficient_scope/);
  assert.deepEqual(a.chamadas, []);
});

test('importação de cidades prepara sem gravar e exige escopo próprio para confirmar', async () => {
  const a = ambiente();
  const args = { transportadora_id: 110, cidades: [{ nome: 'Catolé do Rocha', uf: 'PB' }] };
  const previa = await a.requisitar('preparar_importacao_cidades', args);
  assert.equal(previa.body.result.isError, false);
  assert.deepEqual(a.chamadas, [{ name: 'prepararImportacao', args: [args, { usuario: 'conta-autenticada', scopes: 'clientes:read' }] }]);
  a.chamadas.length = 0;
  const confirmacao = { token_previa: 'token-assinado-de-previa', confirmacao: 'CONFIRMO' };
  for (const escopos of ['clientes:read', 'clientes:read pedidos:write pedidos:manage whatsapp:send', 'logistica:write']) {
    const negado = await a.requisitar('confirmar_importacao_cidades', confirmacao, escopos);
    assert.equal(negado.body.result.isError, true);
    assert.match(negado.body.result._meta['mcp/www_authenticate'][0], /insufficient_scope/);
  }
  assert.deepEqual(a.chamadas, []);
  const permitido = await a.requisitar('confirmar_importacao_cidades', confirmacao, 'clientes:read logistica:write');
  assert.equal(permitido.body.result.isError, false);
  assert.deepEqual(a.chamadas, [{ name: 'confirmarImportacao', args: [
    { token_previa: confirmacao.token_previa }, { usuario: 'conta-autenticada', scopes: 'clientes:read logistica:write' }
  ] }]);
  assert.ok(!JSON.stringify(a.logs).includes(confirmacao.token_previa));
});

test('importação de cidades tem metadados de escrita corretos e independe da flag de pedidos', async () => {
  const a = ambiente();
  process.env.MCP_PEDIDOS_ENABLED = 'false';
  try {
    const lista = await a.requisitar(null, {}, 'clientes:read', { method: 'tools/list' });
    const novas = lista.body.result.tools.filter(t => a.importacao.tools.some(x => x.name === t.name));
    assert.equal(novas.length, 2);
    const confirmar = novas.find(t => t.name === 'confirmar_importacao_cidades');
    assert.equal(confirmar.annotations.readOnlyHint, false);
    assert.equal(confirmar.annotations.destructiveHint, false);
    assert.equal(confirmar.annotations.idempotentHint, true);
    assert.deepEqual(confirmar.securitySchemes[0].scopes, ['clientes:read', 'logistica:write']);
    for (const t of novas) assert.deepEqual(t._meta.securitySchemes, t.securitySchemes);
    const resultado = await a.requisitar('confirmar_importacao_cidades', {
      token_previa: 'token-assinado-de-previa', confirmacao: 'CONFIRMO'
    }, 'clientes:read logistica:write');
    assert.equal(resultado.body.result.isError, false);
  } finally { process.env.MCP_PEDIDOS_ENABLED = 'true'; }
});

test('importação rejeita lote e confirmação inválidos antes de chamar serviços', async () => {
  const a = ambiente();
  for (const args of [
    { transportadora_id: '110', cidades: [{ nome: 'Patos', uf: 'PB' }] },
    { transportadora_id: 110, cidades: [] },
    { transportadora_id: 110, cidades: Array.from({ length: 301 }, () => ({ nome: 'Patos', uf: 'PB' })) },
    { transportadora_id: 110, cidades: [{ nome: 'Patos', uf: 'PB', cidade_id: 1 }] },
    { transportadora_id: 110, cidades: [{ nome: 'Patos', uf: 'PB' }], usuario: 'outra-conta' }
  ]) {
    const res = await a.requisitar('preparar_importacao_cidades', args);
    assert.equal(res.body.error?.code, -32602);
  }
  for (const args of [{ token_previa: 'token-assinado-de-previa' }, { token_previa: 'token-assinado-de-previa', confirmacao: 'SIM' }]) {
    const res = await a.requisitar('confirmar_importacao_cidades', args, 'clientes:read logistica:write');
    assert.equal(res.body.error?.code, -32602);
  }
  assert.deepEqual(a.chamadas, []);
});

test('MCP público continua recusando ferramentas de importação', async () => {
  const router = { use() {}, get() {}, post() {}, delete() {} };
  const publico = carregar('src/routes/integracao/mcpLogistica.routes.js', {
    express: { Router: () => router },
    '../../services/logistica/transportadoraService': {},
    '../../services/logistica/logisticaService': {},
    './mcpOutputSchemas': outputSchemas,
    './mcpProtocol': protocol
  });
  assert.equal(publico.mcpTools.length, 4);
  assert.ok(publico.mcpTools.every(t => t.annotations.readOnlyHint === true));
  await assert.rejects(publico.executeTool('confirmar_importacao_cidades', {}));
});


test('WhatsApp financeiro exige prévia, autorização e a mesma conta do cliente', async () => {
  process.env.MCP_PEDIDOS_ENABLED = 'true';
  const a = ambiente();
  const listar = await a.requisitar(null, {}, 'clientes:read', { method: 'tools/list' });
  const previaFerramenta = listar.body.result.tools.find(t => t.name === 'preparar_whatsapp_pagamentos_cliente');
  const confirmarFerramenta = listar.body.result.tools.find(t => t.name === 'confirmar_whatsapp_pagamentos_cliente');
  assert.ok(previaFerramenta);
  assert.ok(confirmarFerramenta);
  assert.deepEqual(previaFerramenta.securitySchemes[0].scopes, ['clientes:read', 'whatsapp:send']);
  assert.equal(confirmarFerramenta.annotations.destructiveHint, true);
  assert.equal(confirmarFerramenta.annotations.idempotentHint, true);
  const args = { cliente: 'Júnior Representante', quantidade: 3 };
  const negado = await a.requisitar('preparar_whatsapp_pagamentos_cliente', args, 'clientes:read');
  assert.equal(negado.body.result.isError, true);
  assert.deepEqual(a.chamadas, []);
  const preparado = await a.requisitar('preparar_whatsapp_pagamentos_cliente', args, 'clientes:read whatsapp:send');
  assert.equal(preparado.body.result.isError, false);
  assert.equal(a.chamadas[0].name, 'prepararEnvioPagamentos');
  assert.equal(a.chamadas[1].name, 'prepararAcao');
  assert.equal(a.chamadas[1].args[0].tipo, 'whatsapp_pagamentos');
  a.chamadas.length = 0;
  const enviado = await a.requisitar('confirmar_whatsapp_pagamentos_cliente', confirmacao, 'clientes:read whatsapp:send');
  assert.equal(enviado.body.result.isError, false);
  assert.equal(a.chamadas[0].name, 'confirmarAcao');
  assert.equal(a.chamadas[0].args[2], 'whatsapp_pagamentos');
});

test('buscar_clientes aceita nome completo com fallback ao limite da bridge', async () => {
  const consultas = [];
  const a = ambiente({ listarClientesMock: async ({ nome }) => {
    consultas.push(nome);
    if (nome.length > 18) throw new Error('nome muito longo na bridge');
    return [{ favorecido: 262123, nome: 'JÚNIOR REPRESENTANTE', cidade: 'Catolé do Rocha', uf: 'PB' },
      { favorecido: 888, nome: 'JÚNIOR REPRESENTANTE DE OUTRA CIDADE', cidade: 'Outra Cidade', uf: 'PB' }];
  } });
  const r = await a.requisitar('buscar_clientes', { nome: 'Júnior Representante' });
  assert.equal(r.body.result.isError, false);
  assert.deepEqual(consultas, ['Júnior Representante', 'Júnior Representan']);
  assert.equal(r.body.result.structuredContent.total_encontrado, 2);
  assert.equal(r.body.result.structuredContent.clientes[0].favorecido, 262123);
});
