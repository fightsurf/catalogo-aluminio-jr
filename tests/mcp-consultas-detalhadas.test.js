'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function carregar(stubs = {}) {
  const source = fs.readFileSync(path.join(__dirname, '../src/services/integracao/mcpConsultasDetalhadas.service.js'), 'utf8');
  const module = { exports: {} };
  new Function('require', 'module', 'exports', source)((name) => {
    if (name === '../../../db/connection') return stubs.db;
    if (name === '../legado/clientes/clientes.service') return stubs.clientes;
    throw new Error('Dependência inesperada: ' + name);
  }, module, module.exports);
  return module.exports;
}

test('cliente retorna cidade, UF, telefone e observação sem dados inventados', async () => {
  const svc = carregar({ db: { query: async () => ({ rows: [] }) },
    clientes: { buscarCliente: async () => ({
      favorecido: 8, nome: 'Cliente Teste', cidade: 'Patos', uf: 'PB', telefonePrincipal: '83900000000'
    }) }
  });
  const resultado = await svc.consultarCliente({ favorecido: 8 });
  assert.equal(resultado.encontrado, true);
  assert.deepEqual(resultado.cliente, {
    favorecido: 8, nome: 'Cliente Teste', cidade: 'Patos', uf: 'PB',
    telefone: '83900000000', observacao: null
  });
  await assert.rejects(svc.consultarCliente({ favorecido: -1 }), /inválido/);
});

test('logística inclui número de telefone, observação e cidades vinculadas', async () => {
  const chamadas = [];
  const svc = carregar({ clientes: {},
    db: { query: async (sql, params) => {
      chamadas.push({ sql, params });
      if (sql.includes('COUNT(*)')) return { rows: [{ total: 2 }] };
      return { rows: [{
        id: 3, nome: 'Excursão Exemplo', cidade: 'Caicó', uf: 'RN',
        telefone_principal: '84900000000', telefone: '8433333333',
        observacao: 'Entrega às sextas',
        cidades_vinculadas: [{ cidade: 'Jardim de Piranhas', uf: 'RN', observacao: 'Ponto central' }]
      }] };
    } }
  });
  const data = await svc.listarExcursoesTransportadoras({ pagina: 1, limite: 1 });
  assert.equal(data.total_encontrado, 2);
  assert.equal(data.tem_proxima_pagina, true);
  assert.equal(data.cadastros[0].telefone, '84900000000');
  assert.equal(data.cadastros[0].observacao, 'Entrega às sextas');
  assert.equal(data.cadastros[0].cidades_vinculadas[0].cidade, 'Jardim de Piranhas');
  assert.deepEqual(chamadas[1].params, ['', 1, 0]);
  await assert.rejects(svc.listarExcursoesTransportadoras({ limite: 100 }), /inválido/);
});

test('campos completos estão disponíveis somente na rota com OAuth', () => {
  const auth = fs.readFileSync(path.join(__dirname, '../src/routes/integracao/mcpClientes.routes.js'), 'utf8');
  const publicRoute = fs.readFileSync(path.join(__dirname, '../src/routes/integracao/mcpLogistica.routes.js'), 'utf8');
  assert.match(auth, /name: 'consultar_cliente'/);
  assert.match(auth, /name: 'listar_excursoes_transportadoras'/);
  assert.match(auth, /validateAccess\(bearer\[1\]\)/);
  assert.doesNotMatch(publicRoute, /name: 'listar_excursoes_transportadoras'/);
});
