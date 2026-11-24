'use strict';

// Contratos HTTP com Express/Multer reais; banco e provedor de IA simulados.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const multer = require('multer');
const auth = require('../src/middlewares/adminAuth.middleware');

process.env.ADMIN_SESSION_SECRET = 'segredo-exclusivo-do-teste-http';

function cookie(usuario = 'administrador-teste') {
  const corpo = Buffer.from(JSON.stringify({ u: usuario, exp: Date.now() + 60000 })).toString('base64url');
  const assinatura = crypto.createHmac('sha256', process.env.ADMIN_SESSION_SECRET).update(corpo).digest('base64url');
  return 'ajr_admin_session=' + corpo + '.' + assinatura;
}

async function ambiente(t, overrides = {}) {
  const chamadas = [];
  const registrar = nome => async (...args) => { chamadas.push({ nome, args }); return { ok: true }; };
  const dependencias = {
    express, multer,
    '../../middlewares/adminAuth.middleware': auth,
    '../../services/logistica/importacaoCidades.service': {
      prepararImportacao: registrar('preparar'), confirmarImportacao: registrar('confirmar'), ...overrides
    },
    '../../services/logistica/importacaoCidadesIa.service': { interpretar: registrar('interpretar') }
  };
  const modulo = { exports: {} };
  const fonte = fs.readFileSync(path.join(__dirname, '../src/routes/logistica/importacaoCidadesRoutes.js'), 'utf8');
  new Function('require', 'module', 'exports', fonte)(nome => {
    if (!(nome in dependencias)) throw Error('Dependência inesperada: ' + nome);
    return dependencias[nome];
  }, modulo, modulo.exports);
  const app = express();
  const base = '/api/logistica/transportadoras/:id/importacao-cidades';
  app.use(base, auth.requireAuth, express.json({ limit: '256kb' }));
  app.use(express.json());
  app.use(base, modulo.exports);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = 'http://127.0.0.1:' + server.address().port;
  async function enviar(acao, { body = {}, id = '110', autenticado = true, multipart = false } = {}) {
    const resposta = await fetch(url + '/api/logistica/transportadoras/' + id + '/importacao-cidades/' + acao, {
      method: 'POST',
      headers: { ...(autenticado ? { Cookie: cookie() } : {}), ...(!multipart ? { 'Content-Type': 'application/json' } : {}) },
      body: multipart ? body : JSON.stringify(body)
    });
    return { status: resposta.status, headers: resposta.headers, body: await resposta.json() };
  }
  return { enviar, chamadas };
}

test('endpoints recusam sessão ausente antes de chamar IA ou gravar', async t => {
  const a = await ambiente(t);
  for (const acao of ['interpretar', 'previa', 'confirmar']) {
    const resposta = await a.enviar(acao, { autenticado: false });
    assert.equal(resposta.status, 401);
    assert.match(resposta.body.erro, /administrativa/);
  }
  assert.deepEqual(a.chamadas, []);
});

test('prévia e confirmação recebem alvo da URL e conta da sessão, nunca campos livres', async t => {
  const a = await ambiente(t);
  const cidades = [{ nome: 'Patos', uf: 'PB' }];
  const previa = await a.enviar('previa', { body: { cidades, usuario: 'injetado', transportadora_id: 999 } });
  assert.equal(previa.status, 200);
  assert.equal(previa.headers.get('cache-control'), 'no-store');
  assert.deepEqual(a.chamadas[0], { nome: 'preparar', args: [
    { transportadora_id: 110, cidades }, { usuario: 'administrador-teste' }
  ] });
  const token = 'x'.repeat(120000);
  const confirmacao = await a.enviar('confirmar', { body: { token_previa: token, transportadora_id: 999, usuario: 'injetado' } });
  assert.equal(confirmacao.status, 200, 'Parser autenticado precisa comportar o token de uma prévia grande.');
  assert.deepEqual(a.chamadas[1], { nome: 'confirmar', args: [
    { transportadora_id: 110, token_previa: token }, { usuario: 'administrador-teste' }
  ] });
});

test('alvo inválido não chama serviços e conflito da prévia mantém mensagem de validação', async t => {
  const a = await ambiente(t, { confirmarImportacao: async () => {
    throw Object.assign(new Error('A prévia pertence a outra transportadora.'), { status: 409, isValidation: true });
  } });
  for (const id of ['0', '1.5', 'abc', '9007199254740992']) {
    const resposta = await a.enviar('previa', { id });
    assert.equal(resposta.status, 400);
  }
  assert.deepEqual(a.chamadas, []);
  const resposta = await a.enviar('confirmar', { body: { token_previa: 'previa-incompativel' } });
  assert.equal(resposta.status, 409);
  assert.match(resposta.body.erro, /outra transportadora/);
});

test('multipart passa texto, UF explícita e buffers à extração, sem qualquer gravação', async t => {
  const a = await ambiente(t);
  const body = new FormData();
  body.append('texto', 'Patos e Catolé do Rocha');
  body.append('uf_padrao', 'PB');
  body.append('arquivos', new Blob(['%PDF-1.7\nconteudo-do-teste'], { type: 'application/pdf' }), 'cidades.pdf');
  const resposta = await a.enviar('interpretar', { body, multipart: true });
  assert.equal(resposta.status, 200);
  assert.equal(a.chamadas.length, 1);
  assert.equal(a.chamadas[0].nome, 'interpretar');
  const entrada = a.chamadas[0].args[0];
  assert.equal(entrada.texto, 'Patos e Catolé do Rocha');
  assert.equal(entrada.uf_padrao, 'PB');
  assert.equal(entrada.arquivos.length, 1);
  assert.equal(entrada.arquivos[0].mimetype, 'application/pdf');
  assert.ok(Buffer.isBuffer(entrada.arquivos[0].buffer));
});

test('upload recusa formato inesperado e excesso de fotos sem chegar ao provedor', async t => {
  const a = await ambiente(t);
  const invalido = new FormData();
  invalido.append('arquivos', new Blob(['<script>'], { type: 'text/html' }), 'pagina.html');
  assert.equal((await a.enviar('interpretar', { body: invalido, multipart: true })).status, 400);
  const excesso = new FormData();
  for (let i = 0; i < 6; i++) excesso.append('arquivos', new Blob(['foto'], { type: 'image/jpeg' }), 'foto.jpg');
  assert.equal((await a.enviar('interpretar', { body: excesso, multipart: true })).status, 413);
  assert.deepEqual(a.chamadas, []);
});
