const test = require('node:test');
const assert = require('node:assert/strict');
const { buscarPrecosHistoricos } = require('../src/services/legado/pedidos-cliente/precosHistoricos.service');

function mockGet() {
  const dados = {
    '/api/pedidos-cliente/25': {
      dados: [
        { saida: 3, numero: '1003', data: '2026-10-20' },
        { saida: 2, numero: '1002', data: '2026-08-11' },
        { saida: 1, numero: '1001', data: '2026-07-05', situacao: 'C' }
      ]
    },
    '/api/legado/pedidos/3/itens': { data: { itens: [
      { item: 52, descricao: 'Panela Pressão 7 L', preco: 72.25, quantidade: 4 },
      { item: 65, descricao: 'Panela Pressão 4 L', preco: 55, quantidade: 1 }
    ] } },
    '/api/legado/pedidos/2/itens': { data: { itens: [
      { item: 52, descricao: 'Panela Pressão 7 L', preco: 68, quantidade: 2 }
    ] } }
  };
  const chamadas = [];
  const get = async path => {
    chamadas.push(path);
    if (!(path in dados)) throw new Error('Consulta inesperada: ' + path);
    return dados[path];
  };
  return { get, chamadas };
}

test('recupera preços unitários reais e datas de todos os pedidos válidos', async () => {
  const { get, chamadas } = mockGet();
  const resultado = await buscarPrecosHistoricos(25, { item: '52', descricao: 'Panela Pressão 7 L' }, { get });
  assert.deepEqual(resultado.precos.map(p => p.preco), [72.25, 68]);
  assert.deepEqual(resultado.precos.map(p => p.pedidoNumero), ['1003', '1002']);
  assert.equal(chamadas.includes('/api/legado/pedidos/1/itens'), false);
});

test('encontra itens pela descrição quando perfil não fornece código', async () => {
  const { get } = mockGet();
  const resultado = await buscarPrecosHistoricos(25, { descricao: 'panela pressao 7 l' }, { get });
  assert.equal(resultado.precos.length, 2);
});

test('não mistura produtos de códigos diferentes', async () => {
  const { get } = mockGet();
  const resultado = await buscarPrecosHistoricos(25, { item: 65, descricao: 'Panela Pressão 4 L' }, { get });
  assert.deepEqual(resultado.precos.map(p => p.preco), [55]);
});

test('não aceita cliente e item inválidos', async () => {
  const { get } = mockGet();
  await assert.rejects(() => buscarPrecosHistoricos(0, { item: 52 }, { get }), /cliente inválido/);
  await assert.rejects(() => buscarPrecosHistoricos(25, {}, { get }), /código ou descrição/);
});

test('não apresenta histórico parcial quando bridge falhar', async () => {
  const { get: fonte } = mockGet();
  await assert.rejects(() => buscarPrecosHistoricos(25, { item: 52 }, {
    get: async p => p.endsWith('/2/itens') ? Promise.reject(new Error('Bridge indisponível')) : fonte(p)
  }), /Bridge indisponível/);
});
