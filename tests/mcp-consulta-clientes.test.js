'use strict';

// Testes sem PostgreSQL, Firebird ou rede. Valida concessão OAuth e
// a prevenção de reutilização de códigos e refresh tokens.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function stub() {
  const requests = new Map(), codes = new Map(), accesses = new Map(), refreshes = new Map();
  const hash = v => crypto.createHash('sha256').update(v).digest('hex');
  const query = async (sql, p = []) => {
    if (sql.includes('CREATE TABLE IF NOT EXISTS')) return { rows: [] };
    if (sql.includes('INSERT INTO mcp_clientes_oauth_pedidos')) {
      requests.set(p[0], { id: p[0], csrf_hash: p[1], usuario: p[2], estado: p[3], escopo: p[4], desafio: p[5], used: false });
      return { rows: [] };
    }
    if (sql.includes('UPDATE mcp_clientes_oauth_pedidos')) {
      const r = requests.get(p[0]);
      if (!r || r.used || r.csrf_hash !== p[1] || r.usuario !== p[2]) return { rows: [] };
      r.used = true;
      return { rows: [{ usuario: r.usuario, estado: r.estado, escopo: r.escopo, desafio: r.desafio }] };
    }
    if (sql.includes('INSERT INTO mcp_clientes_oauth_codigos')) {
      codes.set(p[0], { usuario: p[1], escopo: p[2], desafio: p[3], used: false });
      return { rows: [] };
    }
    if (sql.includes('UPDATE mcp_clientes_oauth_codigos')) {
      const c = codes.get(p[0]);
      if (!c || c.used) return { rows: [] };
      c.used = true;
      return { rows: [c] };
    }
    if (sql.includes('INSERT INTO mcp_clientes_oauth_acessos')) {
      accesses.set(p[0], { usuario: p[1], escopo: p[2], recurso: p[3] });
      return { rows: [] };
    }
    if (sql.includes('SELECT usuario,escopo,recurso FROM mcp_clientes_oauth_acessos')) {
      return { rows: accesses.has(p[0]) ? [accesses.get(p[0])] : [] };
    }
    if (sql.includes('INSERT INTO mcp_clientes_oauth_refresh')) {
      refreshes.set(p[0], { usuario: p[1], escopo: p[2], recurso: p[3], cliente: p[4], used: false });
      return { rows: [] };
    }
    if (sql.includes('UPDATE mcp_clientes_oauth_refresh')) {
      const r = refreshes.get(p[0]);
      if (!r || r.used || r.cliente !== p[1] || r.recurso !== p[2]) return { rows: [] };
      r.used = true;
      return { rows: [r] };
    }
    throw Error('SQL não esperado: ' + sql.slice(0, 120));
  };
  const filename = path.join(__dirname, '../src/services/integracao/mcpClientesOAuth.service.js');
  const source = fs.readFileSync(filename, 'utf8');
  const module = { exports: {} };
  new Function('require', 'module', 'exports', source)((name) => {
    if (name === 'crypto') return crypto;
    if (name === '../../../db/connection') return { query };
    throw Error('Require inesperado: ' + name);
  }, module, module.exports);
  return module.exports;
}

test('OAuth requer conta administrativa e escopo de leitura', async () => {
  process.env.MCP_CLIENTES_ENABLED = 'true';
  process.env.ADMIN_USER = 'teste';
  process.env.ADMIN_PASSWORD = 'teste';
  process.env.ADMIN_SESSION_SECRET = 'segredo-unitario';
  const oauth = stub();
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true, json: async () => ({
      client_id: oauth.CLIENT_ID, redirect_uris: [oauth.REDIRECT],
      token_endpoint_auth_methods_supported: ['none']
    })
  });
  try {
    const verifier = 'a'.repeat(64);
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const args = {
      response_type: 'code', client_id: oauth.CLIENT_ID,
      redirect_uri: oauth.REDIRECT, resource: oauth.resource(),
      code_challenge: challenge, code_challenge_method: 'S256',
      state: 'estado-com-8-caracteres', scope: 'clientes:read offline_access'
    };
    await assert.rejects(
      oauth.newAuthRequest({ ...args, resource: 'https://outro.site/mcp' }, 'teste'),
      err => err.oauthCode === 'invalid_target'
    );
    const pending = await oauth.newAuthRequest(args, 'teste');
    const callback = await oauth.decideConsent({ ...pending, decision: 'aprovar', user: 'teste' });
    const url = new URL(callback);
    assert.equal(url.searchParams.get('iss'), oauth.issuer());
    assert.equal(url.searchParams.get('state'), args.state);
    const code = url.searchParams.get('code');
    const tokenResponse = await oauth.exchangeToken({
      grant_type: 'authorization_code', client_id: oauth.CLIENT_ID,
      redirect_uri: oauth.REDIRECT, code, code_verifier: verifier, resource: oauth.resource()
    });
    assert.equal(tokenResponse.scope, args.scope);
    assert.ok(tokenResponse.refresh_token);
    assert.equal((await oauth.validateAccess(tokenResponse.access_token)).user, 'teste');
    await assert.rejects(
      oauth.exchangeToken({ grant_type: 'authorization_code', client_id: oauth.CLIENT_ID,
        redirect_uri: oauth.REDIRECT, code, code_verifier: verifier }),
      err => err.oauthCode === 'invalid_grant'
    );
    const rotated = await oauth.exchangeToken({ grant_type: 'refresh_token', client_id: oauth.CLIENT_ID,
      refresh_token: tokenResponse.refresh_token });
    assert.ok(rotated.access_token);
    await assert.rejects(
      oauth.exchangeToken({ grant_type: 'refresh_token', client_id: oauth.CLIENT_ID,
        refresh_token: tokenResponse.refresh_token }),
      err => err.oauthCode === 'invalid_grant'
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('MCP clientes não anuncia operações de escrita', () => {
  const filename = path.join(__dirname, '../src/routes/integracao/mcpClientes.routes.js');
  const code = fs.readFileSync(filename, 'utf8');
  assert.match(code, /name: 'buscar_clientes'/);
  assert.doesNotMatch(code, /name: '(confirmar_pedido|preparar_pedido|inserir_pedido)'/);
  assert.match(code, /readOnlyHint: true/);
  assert.match(code, /scope="clientes:read"/);
});

test('MCP de clientes incorpora as quatro consultas de logística sem outro plugin', () => {
  const clientes = fs.readFileSync(path.join(__dirname, '../src/routes/integracao/mcpClientes.routes.js'), 'utf8');
  const logistica = fs.readFileSync(path.join(__dirname, '../src/routes/integracao/mcpLogistica.routes.js'), 'utf8');
  assert.match(clientes, /require\('\.\/mcpLogistica\.routes'\)/);
  assert.match(clientes, /tools: TOOLS/);
  assert.match(clientes, /logistica\.executeTool\(name, args\)/);
  assert.match(clientes, /validateAccess\(bearer\[1\]\)/);
  assert.match(logistica, /module\.exports\.mcpTools = tools/);
  assert.match(logistica, /module\.exports\.executeTool = executeTool/);
  for (const tool of [
    'consultar_transportadoras', 'buscar_cidades',
    'listar_cidades_da_transportadora', 'transportadoras_por_cidade'
  ]) assert.match(logistica, new RegExp("name: '" + tool + "'"));
  assert.doesNotMatch(clientes, /name: '(inserir|criar|atualizar|excluir|deletar)_/);
});
