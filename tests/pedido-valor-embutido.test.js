const test = require('node:test');
const assert = require('node:assert/strict');
const rateio = require('../public/js/pedido-valor-embutido');

const produto = (preco = 30) => ({ id: 42, item_legado: 142, nome: 'Brinde', preco });
const pedido = () => [
  { item: 1, quantidade: 100, preco: 10 },
  { item: 2, quantidade: 400, preco: 20 }
];
const clone = value => JSON.parse(JSON.stringify(value));
const semEstadoLocal = itens => itens.map(({ __valorEmbutido, ...item }) => clone(item));

test('meio centavo arredonda para cima sem erro binário na divisão', () => {
  const resumo = rateio.simular([{ quantidade: 2 }], 20.15);
  assert.equal(resumo.acrescimoUnitario, 10.08);
  assert.equal(resumo.totalDistribuido, 20.16);
  assert.equal(resumo.diferenca, 0.01);
});

test('R$ 30 em 500 unidades soma R$ 0,06 por unidade e R$ 30 no pedido', () => {
  const itens = pedido();
  const estado = rateio.aplicar(itens, produto());
  assert.equal(estado.quantidadeTotal, 500);
  assert.equal(estado.acrescimoUnitario, 0.06);
  assert.equal(estado.totalDistribuido, 30);
  assert.equal(estado.diferenca, 0);
  assert.deepEqual(itens.map(item => item.preco), [10.06, 20.06]);
  assert.deepEqual(estado.linhas.map(item => item.quantidade * item.acrescimoUnitario), [6, 24]);
});

test('retirar devolve os preços-base sem alterar quantidades ou produtos', () => {
  const itens = pedido();
  const original = clone(itens);
  const estado = rateio.aplicar(itens, produto());
  assert.equal(rateio.remover(itens, estado), null);
  assert.deepEqual(itens, original);
  rateio.remover(itens, null);
  assert.deepEqual(itens, original);
});

test('retirar preserva negociação manual posterior ao acréscimo', () => {
  const itens = pedido();
  let estado = rateio.aplicar(itens, produto());
  rateio.definirPreco(itens[0], 12.56);
  estado = rateio.serializar(itens, estado);
  assert.equal(estado.linhas[0].precoBase, 12.5);
  assert.equal(estado.linhas[0].acrescimoUnitario, 0.06);
  rateio.remover(itens, estado);
  assert.deepEqual(itens.map(item => item.preco), [12.5, 20]);
});

test('trocar quantidade redistribui o valor usando os mesmos preços-base', () => {
  const itens = pedido();
  let estado = rateio.aplicar(itens, produto());
  itens[1].quantidade = 150;
  estado = rateio.recalcular(itens, estado);
  assert.equal(estado.quantidadeTotal, 250);
  assert.equal(estado.acrescimoUnitario, 0.12);
  assert.equal(estado.totalDistribuido, 30);
  assert.deepEqual(itens.map(item => item.preco), [10.12, 20.12]);
  rateio.remover(itens, estado);
  assert.deepEqual(itens.map(item => item.preco), [10, 20]);
});

test('substituir ou reaplicar produto não acumula o rateio anterior', () => {
  const itens = pedido();
  let estado = rateio.aplicar(itens, produto());
  estado = rateio.aplicar(itens, produto(50), estado);
  assert.deepEqual(itens.map(item => item.preco), [10.1, 20.1]);
  assert.equal(estado.totalDistribuido, 50);
  estado = rateio.aplicar(itens, produto(50), estado);
  assert.deepEqual(itens.map(item => item.preco), [10.1, 20.1]);
  assert.equal(estado.totalDistribuido, 50);
});

test('salvar em JSON e recarregar permite desfazer sem depender de estado do navegador', () => {
  const itens = pedido();
  const persistido = clone(rateio.aplicar(itens, produto()));
  const carregados = semEstadoLocal(itens);
  rateio.carregar(carregados, persistido);
  assert.deepEqual(carregados.map(item => item.preco), [10.06, 20.06]);
  rateio.remover(carregados, persistido);
  assert.deepEqual(carregados, pedido());
});

test('carregar preserva diferença manual do preço final e IDs recriados pelo legado', () => {
  const itens = pedido();
  const persistido = clone(rateio.aplicar(itens, produto()));
  const carregados = semEstadoLocal(itens);
  carregados[0].preco = 11.06;
  carregados[0].saidaItem = 999;
  rateio.remover(carregados, persistido);
  assert.deepEqual(carregados.map(item => item.preco), [11, 20]);
  assert.equal(carregados[0].saidaItem, 999);
});

test('linhas repetidas do mesmo produto são associadas pelo conteúdo após reordenação', () => {
  const itens = [
    { item: 1, quantidade: 100, preco: 10, saidaItem: 1 },
    { item: 1, quantidade: 400, preco: 15, saidaItem: 2 }
  ];
  const persistido = clone(rateio.aplicar(itens, produto()));
  const carregados = semEstadoLocal(itens).reverse();
  carregados.forEach((item, index) => { item.saidaItem = index + 90; });
  rateio.remover(carregados, persistido);
  assert.deepEqual(carregados.map(item => item.preco), [15, 10]);
  assert.deepEqual(carregados.map(item => item.quantidade), [400, 100]);
});

test('arredondamento expõe valor distribuído e diferença sem prometer total exato', () => {
  const resumo = rateio.simular([{ item: 1, quantidade: 3, preco: 10 }], 1);
  assert.deepEqual(resumo, {
    quantidadeTotal: 3, acrescimoUnitario: 0.33, totalDistribuido: 0.99, diferenca: -0.01
  });
  const itens = [{ item: 1, quantidade: 3, preco: 10 }];
  const estado = rateio.aplicar(itens, produto(1));
  assert.equal(estado.totalDistribuido, 0.99);
  assert.equal(estado.diferenca, -0.01);
});

test('pedido vazio, valores não positivos e quantidades inválidas não alteram itens', () => {
  assert.throws(() => rateio.aplicar([], produto()), /Adicione os itens/);
  for (const valor of [0, -1, NaN, Infinity]) {
    const itens = pedido();
    assert.throws(() => rateio.aplicar(itens, produto(valor)));
    assert.deepEqual(itens, pedido());
  }
  for (const quantidade of [0, -1, NaN, Infinity]) {
    const itens = pedido();
    itens[1].quantidade = quantidade;
    const antes = itens.map(item => ({ ...item }));
    assert.throws(() => rateio.aplicar(itens, produto()));
    assert.deepEqual(itens, antes);
  }
});

test('acréscimo que arredonda para zero é recusado sem alterar preços', () => {
  const itens = pedido();
  assert.throws(() => rateio.aplicar(itens, produto(0.01)), /abaixo de um centavo/);
  assert.deepEqual(itens, pedido());
});

test('preço inválido no meio do pedido mantém aplicação atômica', () => {
  const itens = pedido();
  itens[1].preco = NaN;
  assert.throws(() => rateio.aplicar(itens, produto()), /Preço-base inválido/);
  assert.equal(itens[0].preco, 10);
  assert.equal(itens[0].__valorEmbutido, undefined);
});

test('metadados incompatíveis não deixam restauração parcial nem retiram valor errado', () => {
  const itens = pedido();
  const persistido = clone(rateio.aplicar(itens, produto()));
  const carregados = semEstadoLocal(itens);
  carregados[1].item = 999;
  assert.throws(() => rateio.remover(carregados, persistido), /itens mudaram/);
  assert.deepEqual(carregados.map(item => item.preco), [10.06, 20.06]);
  assert.ok(carregados.every(item => !item.__valorEmbutido));
});

test('redução abaixo do acréscimo não altera preço nem base e preço-base explícito conserva rateio', () => {
  const itens = pedido();
  const estado = rateio.aplicar(itens, produto());
  assert.throws(() => rateio.definirPreco(itens[0], 0.01), /menor que o acréscimo/);
  assert.equal(itens[0].preco, 10.06);
  assert.equal(itens[0].__valorEmbutido.precoBase, 10);
  rateio.definirPreco(itens[0], 12.345, { base: true });
  assert.equal(itens[0].preco, 12.405);
  rateio.remover(itens, estado);
  assert.equal(itens[0].preco, 12.345);
});
