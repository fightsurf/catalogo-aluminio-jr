'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function ambiente() {
  const source = fs.readFileSync(path.join(__dirname, '../src/services/whatsapp/relatorio-fotos-whatsapp.service.js'), 'utf8');
  const produto = { id: 5, item_legado: 10, nome: 'Panela 4,5 L', ativo: true, foto: 'https://exemplo.invalid/panela.jpg' };
  const envios = [];
  const deps = {
    '../produto/produto.service': { listar: async () => [produto], buscar: async () => produto },
    '../integracoes/zapi.service': { enviarImagem: async dados => { envios.push(dados); return { zapi: { id: 'foto' } }; } }
  };
  const modulo = { exports: {} };
  new Function('require', 'module', 'exports', source)(name => {
    assert.ok(Object.hasOwn(deps, name), 'Dependência sem mock: ' + name);
    return deps[name];
  }, modulo, modulo.exports);
  const argumentos = { telefone: '5584999999999', produtoId: 5, quantidade: 50, unitario: 35.9, subtotal: 1795, indice: 1, totalItens: 1 };
  return { produto, envios, argumentos, ...modulo.exports };
}

test('a prévia das fotos bloqueia produto inativo antes de permitir confirmar', async () => {
  const a = ambiente(); a.produto.ativo = false;
  const r = await a.analisarRelatorio({ itensPedido: [{ item: 10, descricao: 'Panela 4,5 L', quantidade: 50, preco: 35.9, subtotal: 1795 }], totalPedido: 1795, multiplicador: 1 });
  assert.equal(r.prontoParaEnvio, false);
  assert.match(r.pendencias[0].problema, /inativo/);
  assert.equal(a.envios.length, 0);
});

test('a mesma função da tela impede trocar a foto ou a legenda após confirmação MCP', async () => {
  for (const mudar of [p => { p.foto = 'https://exemplo.invalid/nova.jpg'; }, p => { p.nome = 'Outro produto'; }]) {
    const a = ambiente();
    const produtoEsperado = { nome: a.produto.nome, foto: a.produto.foto };
    mudar(a.produto);
    await assert.rejects(a.enviarItem(a.argumentos, { produtoEsperado }), erro => erro.isValidation === true);
    assert.equal(a.envios.length, 0);
  }
});

test('o envio já existente da tela continua usando a rotina sem opções MCP', async () => {
  const a = ambiente();
  await a.enviarItem(a.argumentos);
  assert.equal(a.envios.length, 1);
  assert.equal(a.envios[0].imagem, a.produto.foto);
  assert.match(a.envios[0].legenda, /Quantidade: 50/);
});
