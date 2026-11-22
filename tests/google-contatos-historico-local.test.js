'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SERVICE = path.join(__dirname, '../src/services/bot/google-contatos.service.js');
const codigo = fs.readFileSync(SERVICE, 'utf8');

// Testes isolados: nao consultam o Google, a Z-API nem a base de producao.
function carregar(opcoes = {}) {
  const chamadas = [];
  const conhecidosGoogle = new Set(opcoes.googleConhecidos || []);
  let consultasLegado = 0;
  const pool = {
    async query(sql, params) {
      chamadas.push({ sql, params });
      if (sql.startsWith('CREATE TABLE')) return { rows: [] };
      if (sql.includes('SELECT EXISTS (SELECT 1 FROM bot_google_contatos)')) {
        return { rows: [{ disponivel: opcoes.copia !== false }] };
      }
      if (sql.includes('SELECT 1 FROM bot_google_contatos WHERE')) {
        return { rowCount: params[0].some(n => conhecidosGoogle.has(n)) ? 1 : 0 };
      }
      if (sql.includes('SELECT sincronizado_em')) return { rows: [] };
      if (sql.includes('COUNT(*)::integer AS quantidade')) {
        return { rows: [{ quantidade: opcoes.copia === false ? 0 : 2227 }] };
      }
      if (sql.includes('SELECT refresh_token')) return { rows: [] };
      if (sql.includes('DELETE FROM bot_google_contatos_conexao')) return { rowCount: 1 };
      throw new Error('Consulta inesperada: ' + sql);
    }
  };
  const dependencias = {
    '../../../db/connection': pool,
    './botAutonomia.services': { getAutonomiaAtiva: async () => opcoes.botLigado !== false },
    '../legado/clientes/clientes.service': {
      listarClientes: async () => {
        consultasLegado++;
        if (opcoes.legadoFalha) throw new Error('Legado indisponivel');
        return opcoes.legadoConhecido ? [{ telefonePrincipal: '(83) 99999-1111' }] : [];
      }
    }
  };
  const modulo = { exports: {} };
  // Evita agendadores reais na avaliacao da unidade.
  new Function('require', 'module', 'exports', 'setTimeout', codigo)(
    nome => Object.prototype.hasOwnProperty.call(dependencias, nome)
      ? dependencias[nome] : require(nome),
    modulo, modulo.exports, () => null
  );
  return { ...modulo.exports, chamadas, consultasLegado: () => consultasLegado };
}

test('numero conhecido da copia local nao recebe saudacao sem OAuth', async () => {
  const app = carregar({ googleConhecidos: ['558399991111'] });
  const autorizado = await app.autorizarPrimeiroContato('5583999991111');
  assert.equal(autorizado, false, 'reconhecer variante sem nono digito');
  assert.equal(app.consultasLegado(), 0);
});

test('numero realmente novo pode ser saudado mesmo sem conexao Google', async () => {
  const app = carregar();
  assert.equal(await app.autorizarPrimeiroContato('5583999991111'), true);
  const estado = await app.status();
  assert.equal(estado.conectado, false);
  assert.equal(estado.historico_quantidade, 2227);
  assert.equal(estado.apto, true);
});

test('sem copia local, nao envia saudacao por seguranca', async () => {
  const app = carregar({ copia: false });
  assert.equal(await app.autorizarPrimeiroContato('5583999991111'), false);
});

test('cliente do legado nao recebe saudacao', async () => {
  const app = carregar({ legadoConhecido: true });
  assert.equal(await app.autorizarPrimeiroContato('5583999991111'), false);
  assert.ok(app.consultasLegado() > 0);
});

test('erro na consulta ao legado bloqueia saudacao', async () => {
  const app = carregar({ legadoFalha: true });
  assert.equal(await app.autorizarPrimeiroContato('5583999991111'), false);
});

test('bot desligado nao envia saudacao', async () => {
  const app = carregar({ botLigado: false });
  assert.equal(await app.autorizarPrimeiroContato('5583999991111'), false);
});

test('desconectar remove token, nao o arquivo permanente', async () => {
  const app = carregar();
  await app.desconectar();
  assert.ok(app.chamadas.some(c => c.sql.includes('DELETE FROM bot_google_contatos_conexao')));
  assert.ok(!app.chamadas.some(c => /DELETE FROM bot_google_contatos(?:['\s;]|$)/.test(c.sql)));
});

test('reconectar e sincronizar fazem merge e nunca limpam telefones antigos', () => {
  assert.match(codigo, /ON CONFLICT \(telefone\) DO UPDATE SET/);
  assert.doesNotMatch(codigo, /DELETE FROM bot_google_contatos(?:['\s;]|$)/);
  assert.doesNotMatch(codigo, /setInterval\(executar/);
});
