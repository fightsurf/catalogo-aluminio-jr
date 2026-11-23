'use strict';

// Banco transacional em memória, sem PostgreSQL, credenciais ou rede reais.
// As transações concorrentes disputam a mesma credencial como no bloqueio de linha.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

Object.assign(process.env, {
  MCP_CLIENTES_ENABLED: 'true', ADMIN_USER: 'teste',
  ADMIN_PASSWORD: 'teste', ADMIN_SESSION_SECRET: 'segredo-unitario'
});

const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const source = fs.readFileSync(path.join(__dirname, '../src/services/integracao/mcpClientesOAuth.service.js'), 'utf8');

function harness({ failOnce, failRollback = false } = {}) {
  let state = { requests: new Map(), codes: new Map(), accesses: new Map(), refreshes: new Map() };
  let queue = Promise.resolve();
  let pendingFailure = failOnce;
  const stats = { connections: 0, commits: 0, rollbacks: 0, releases: 0, discarded: 0 };
  const databaseError = new Error('Falha transitória simulada no banco');
  const rows = row => ({ rows: row ? [{ ...row }] : [] });
  const eligible = row => row && !row.used && !row.expired;

  function execute(db, sql, p = []) {
    if (sql.includes('CREATE TABLE IF NOT EXISTS')) return rows();
    if (sql.includes('SELECT usuario,escopo,recurso FROM mcp_clientes_oauth_acessos')) {
      return rows(db.accesses.get(p[0]));
    }
    if (sql.includes('UPDATE mcp_clientes_oauth_pedidos')) {
      const row = db.requests.get(p[0]);
      if (!eligible(row) || row.csrf_hash !== p[1] || row.usuario !== p[2]) return rows();
      row.used = true;
      return rows(row);
    }
    if (sql.includes('UPDATE mcp_clientes_oauth_codigos')) {
      const row = db.codes.get(p[0]);
      if (!eligible(row)) return rows();
      row.used = true;
      return rows(row);
    }
    if (sql.includes('UPDATE mcp_clientes_oauth_refresh')) {
      const row = db.refreshes.get(p[0]);
      if (!eligible(row) || row.cliente !== p[1] || row.recurso !== p[2]) return rows();
      row.used = true;
      return rows(row);
    }
    if (sql.includes('INSERT INTO mcp_clientes_oauth_codigos')) {
      db.codes.set(p[0], { usuario: p[1], escopo: p[2], desafio: p[3], used: false });
      return rows();
    }
    if (sql.includes('INSERT INTO mcp_clientes_oauth_acessos')) {
      db.accesses.set(p[0], { usuario: p[1], escopo: p[2], recurso: p[3] });
      return rows();
    }
    if (sql.includes('INSERT INTO mcp_clientes_oauth_refresh')) {
      db.refreshes.set(p[0], { usuario: p[1], escopo: p[2], recurso: p[3], cliente: p[4], used: false });
      return rows();
    }
    throw Error('SQL inesperado no teste: ' + sql);
  }

  const pool = {
    query: async (sql, p) => {
      if (/^(UPDATE|INSERT)/.test(sql)) throw Error('Escrita OAuth fora da conexão transacional');
      return execute(state, sql, p);
    },
    connect: async () => {
      stats.connections++;
      let local;
      let unlock;
      const finish = () => { local = undefined; if (unlock) { unlock(); unlock = undefined; } };
      return {
        query: async (sql, p) => {
          if (pendingFailure && sql.includes(pendingFailure)) {
            pendingFailure = undefined;
            throw databaseError;
          }
          if (sql === 'BEGIN') {
            const previous = queue;
            queue = new Promise(resolve => { unlock = resolve; });
            await previous;
            local = structuredClone(state);
            return rows();
          }
          assert.ok(local, 'Operações precisam da transação iniciada');
          if (sql === 'COMMIT') {
            stats.commits++;
            state = local;
            finish();
            return rows();
          }
          if (sql === 'ROLLBACK') {
            stats.rollbacks++;
            if (failRollback) throw new Error('Conexão indisponível durante rollback');
            finish();
            return rows();
          }
          return execute(local, sql, p);
        },
        release: error => { stats.releases++; if (error) stats.discarded++; finish(); }
      };
    }
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', source)(name => {
    if (name === 'crypto') return crypto;
    if (name === '../../../db/connection') return pool;
    throw Error('Dependência inesperada: ' + name);
  }, module, module.exports);
  const oauth = module.exports;
  const scope = 'clientes:read pedidos:write';
  const verifier = 'v'.repeat(64);
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');

  function seedRefresh(overrides = {}) {
    const refresh = 'r'.repeat(43);
    state.refreshes.set(hash(refresh), {
      usuario: 'teste', escopo: scope, recurso: oauth.resource(), cliente: oauth.CLIENT_ID,
      used: false, ...overrides
    });
    return { grant_type: 'refresh_token', client_id: oauth.CLIENT_ID,
      resource: oauth.resource(), refresh_token: refresh };
  }
  function seedCode(overrides = {}) {
    const code = 'c'.repeat(43);
    state.codes.set(hash(code), { usuario: 'teste', escopo: scope, desafio: challenge, used: false, ...overrides });
    return { grant_type: 'authorization_code', client_id: oauth.CLIENT_ID, redirect_uri: oauth.REDIRECT,
      resource: oauth.resource(), code, code_verifier: verifier };
  }
  function seedConsent() {
    const id = crypto.randomUUID(), csrf = 's'.repeat(43);
    state.requests.set(id, { csrf_hash: hash(csrf), usuario: 'teste', estado: 'estado-original',
      escopo: scope, desafio: challenge, used: false });
    return { id, csrf, user: 'teste', decision: 'aprovar' };
  }
  return { oauth, stats, scope, databaseError, seedRefresh, seedCode, seedConsent, state: () => state };
}

for (const grant of ['refresh', 'code']) {
  for (const failure of ['INSERT INTO mcp_clientes_oauth_acessos', 'INSERT INTO mcp_clientes_oauth_refresh', 'COMMIT']) {
    test(`${grant}: falha em ${failure} preserva credencial e não deixa tokens órfãos`, async () => {
      const h = harness({ failOnce: failure });
      const request = grant === 'refresh' ? h.seedRefresh() : h.seedCode();
      const before = structuredClone(h.state());
      await assert.rejects(h.oauth.exchangeToken(request), error => error === h.databaseError);
      assert.deepEqual(h.state(), before);
      assert.equal(h.stats.rollbacks, 1);
      assert.equal(h.stats.releases, 1);

      const result = await h.oauth.exchangeToken(request);
      assert.equal(result.scope, h.scope);
      assert.equal(result.expires_in, 900);
      assert.equal((await h.oauth.validateAccess(result.access_token)).user, 'teste');
      assert.equal(h.state().accesses.size, 1);
      assert.equal(h.state().refreshes.size, grant === 'refresh' ? 2 : 1);
      await assert.rejects(h.oauth.exchangeToken(request), { oauthCode: 'invalid_grant' });
      assert.equal(h.state().accesses.size, 1);
      assert.equal(h.stats.connections, h.stats.releases);
    });
  }
}

test('consentimento só é consumido quando o código é persistido', async () => {
  const h = harness({ failOnce: 'INSERT INTO mcp_clientes_oauth_codigos' });
  const request = h.seedConsent();
  const before = structuredClone(h.state());
  await assert.rejects(h.oauth.decideConsent(request), error => error === h.databaseError);
  assert.deepEqual(h.state(), before);
  const callback = new URL(await h.oauth.decideConsent(request));
  assert.equal(callback.searchParams.get('state'), 'estado-original');
  assert.ok(callback.searchParams.get('code'));
  assert.equal(h.state().codes.size, 1);
  await assert.rejects(h.oauth.decideConsent(request), { oauthCode: 'invalid_request' });
  assert.equal(h.stats.connections, h.stats.releases);
});

test('recusar consentimento permanece uma decisão de uso único sem emitir código', async () => {
  const h = harness();
  const request = h.seedConsent();
  const callback = new URL(await h.oauth.decideConsent({ ...request, decision: 'negar' }));
  assert.equal(callback.searchParams.get('error'), 'access_denied');
  assert.equal(h.state().codes.size, 0);
  await assert.rejects(h.oauth.decideConsent(request), { oauthCode: 'invalid_request' });
});

test('PKCE inválido não emite tokens e a transação não consome o código', async () => {
  const h = harness();
  const request = h.seedCode();
  const before = structuredClone(h.state());
  await assert.rejects(h.oauth.exchangeToken({ ...request, code_verifier: 'x'.repeat(64) }), { oauthCode: 'invalid_grant' });
  assert.deepEqual(h.state(), before);
  assert.ok((await h.oauth.exchangeToken(request)).access_token);
});

for (const grant of ['refresh', 'code']) {
  test(`${grant}: duas trocas concorrentes emitem somente um par de tokens`, async () => {
    const h = harness();
    const request = grant === 'refresh' ? h.seedRefresh() : h.seedCode();
    const results = await Promise.allSettled([h.oauth.exchangeToken(request), h.oauth.exchangeToken(request)]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(results.find(result => result.status === 'rejected').reason.oauthCode, 'invalid_grant');
    assert.equal(h.state().accesses.size, 1);
    assert.equal([...h.state().refreshes.values()].filter(row => !row.used).length, 1);
    assert.equal(h.stats.commits, 1);
    assert.equal(h.stats.rollbacks, 1);
    assert.equal(h.stats.connections, h.stats.releases);
  });
}

test('renovação não amplia escopos e preserva cliente, recurso e expiração', async () => {
  const h = harness();
  const request = h.seedRefresh({ escopo: 'clientes:read' });
  const result = await h.oauth.exchangeToken({ ...request, scope: 'clientes:read pedidos:write whatsapp:send' });
  assert.equal(result.scope, 'clientes:read');
  assert.equal(h.state().refreshes.get(hash(result.refresh_token)).escopo, 'clientes:read');
  for (const invalid of [
    { cliente: 'outro-cliente' }, { recurso: 'https://outro.example/mcp' }, { expired: true }
  ]) {
    const blocked = harness();
    const blockedRequest = blocked.seedRefresh(invalid);
    await assert.rejects(blocked.oauth.exchangeToken(blockedRequest), { oauthCode: 'invalid_grant' });
    assert.equal(blocked.state().accesses.size, 0);
  }
});

test('falha de rollback preserva o erro original e descarta a conexão', async () => {
  const h = harness({ failOnce: 'INSERT INTO mcp_clientes_oauth_refresh', failRollback: true });
  const request = h.seedRefresh();
  const before = structuredClone(h.state());
  await assert.rejects(h.oauth.exchangeToken(request), error => error === h.databaseError);
  assert.equal(h.stats.discarded, 1);
  assert.equal(h.stats.releases, 1);
  assert.deepEqual(h.state(), before);
});
