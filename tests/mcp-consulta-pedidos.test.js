'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function carregarServico() {
  const source = fs.readFileSync(path.join(__dirname, '../src/services/integracao/mcpConsultaPedidos.service.js'), 'utf8');
  const chamados = [];
  const registros = [
    { idMestre: 101, numero: '0020020', data: '2026-11-22', situacao: 'C',
      cliente: { nome: 'Kaká' }, total: 1795 },
    { idMestre: 102, numero: '0020021', data: '2026-11-22', situacao: 'A',
      cliente: { nome: 'Eloise Karine', cidade: 'Santana do Matos', uf: 'RN' },
      vendedor: { nome: 'George' }, total: 1795,
      carradaAtual: { codigo: 1697, data: '2026-12-02' } }
  ];
  const fake = {
    pesquisarPedidos: async filtros => { chamados.push(['pesquisa', filtros]); return registros; },
    buscarDetalhePedido: async id => { chamados.push(['detalhe', id]);
      return id === 102 ? { ...registros[1], itens: [
        { item: 55, descricao: 'Panela 4,5 L sem caixa', quantidade: 50, preco: 35.9, subtotal: 1795 }
      ] } : null;
    }
  };
  const m = { exports: {} };
  new Function('require', 'module', 'exports', source)(
    name => {
      assert.equal(name, '../legado/pedido/pedidosLegado.service');
      return fake;
    }, m, m.exports
  );
  return { service: m.exports, chamados };
}

test('consulta de pedido exige filtro e bloqueia parâmetros exagerados', async () => {
  const { service } = carregarServico();
  await assert.rejects(service.consultarPedidos({}), /Informe o número/);
  await assert.rejects(service.consultarPedidos({ cliente: 'Cliente', limite: 100 }), /Limite/);
  await assert.rejects(service.consultarPedidos({ data: '2026-02-30' }), /Data inválida/);
});
test('consulta com filtro retorna pedido e carrada sem alterar dados', async () => {
  const { service, chamados } = carregarServico();
  const r = await service.consultarPedidos({ numero: '0020021' });
  assert.equal(r.pedidos[1].numero, '0020021');
  assert.equal(r.pedidos[1].carrada.codigo, 1697);
  assert.equal(r.somente_leitura, true);
  assert.equal(chamados[0][1].numero, '0020021');
});
test('consulta pode ocultar cancelados somente com filtro solicitado', async () => {
  const { service } = carregarServico();
  const r = await service.consultarPedidos({ cliente: 'Karine', incluir_cancelados: false });
  assert.equal(r.pedidos.length, 1);
  assert.equal(r.pedidos[0].cancelado, false);
});
test('detalha itens por id interno sem confundir com número visível', async () => {
  const { service, chamados } = carregarServico();
  const r = await service.detalharPedido({ id_mestre: 102 });
  assert.equal(r.pedido.itens[0].quantidade, 50);
  assert.equal(r.pedido.itens[0].preco_unitario, 35.9);
  assert.deepEqual(chamados.at(-1), ['detalhe', 102]);
  await assert.rejects(service.detalharPedido({ id_mestre: '0020021' }), /ID real/);
});
test('MCP registra consulta com autenticação apenas de leitura', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/routes/integracao/mcpPedidosTools.js'), 'utf8');
  for (const nome of ['consultar_pedidos', 'detalhar_pedido']) {
    const s = source.split("name: '" + nome + "'")[1]?.split("name: '")[0] || '';
    assert.match(s, /securitySchemes: leitura/);
    assert.match(s, /annotations: readOnly/);
  }
  assert.match(source, /case 'consultar_pedidos': return consultaPedidos\.consultarPedidos\(args\)/);
});
