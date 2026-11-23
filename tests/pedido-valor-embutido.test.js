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

test('meio centavo arredonda para cima com o mesmo acréscimo nas duas unidades', () => {
  const resumo = rateio.simular([{ quantidade: 2 }], 20.15);
  assert.equal(resumo.acrescimoUnitario, 10.08);
  assert.equal(resumo.acrescimoUnitarioMaximo, 10.08);
  assert.equal(resumo.unidadesCentavoExtra, 0);
  assert.equal(resumo.totalDistribuido, 20.16);
  assert.equal(resumo.diferenca, 0.01);
});

test('R$ 29 em 340 unidades acrescenta R$ 0,09 em todos os produtos sem dividir linhas', () => {
  const original = [
    { item: 1, quantidade: 160, preco: 10 },
    { item: 2, quantidade: 180, preco: 20 }
  ];
  const itens = clone(original);
  const estado = rateio.aplicar(itens, produto(29));
  assert.equal(estado.valor, 29);
  assert.equal(estado.quantidadeTotal, 340);
  assert.equal(estado.acrescimoUnitario, 0.09);
  assert.equal(estado.acrescimoUnitarioMaximo, 0.09);
  assert.equal(estado.unidadesCentavoExtra, 0);
  assert.equal(estado.totalDistribuido, 30.6);
  assert.equal(estado.diferenca, 1.6);
  assert.deepEqual(itens.map(item => [item.item, item.quantidade, item.preco]), [[1, 160, 10.09], [2, 180, 20.09]]);
  assert.deepEqual(estado.linhas.map(linha => linha.acrescimoUnitario), [0.09, 0.09]);
  const recarregados = semEstadoLocal(itens);
  rateio.remover(recarregados, clone(estado));
  assert.deepEqual(recarregados, original);
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

test('carregar recusa preço alterado externamente, mas aceita IDs recriados pelo legado', () => {
  const itens = pedido();
  const persistido = clone(rateio.aplicar(itens, produto()));
  const carregados = semEstadoLocal(itens);
  carregados[0].preco = 11.06;
  carregados[0].saidaItem = 999;
  assert.throws(() => rateio.remover(carregados, persistido), /itens mudaram/);
  assert.deepEqual(carregados.map(item => item.preco), [11.06, 20.06]);
  assert.ok(carregados.every(item => !item.__valorEmbutido));
  carregados[0].preco = 10.06;
  rateio.remover(carregados, persistido);
  assert.deepEqual(carregados.map(item => item.preco), [10, 20]);
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

test('um real em três unidades acrescenta R$ 0,34 a todas e informa R$ 1,02 no total', () => {
  const resumo = rateio.simular([{ item: 1, quantidade: 3, preco: 10 }], 1);
  assert.deepEqual(resumo, {
    quantidadeTotal: 3, acrescimoUnitario: 0.34, acrescimoUnitarioMaximo: 0.34, unidadesCentavoExtra: 0, totalDistribuido: 1.02, diferenca: 0.02
  });
  const itens = [{ item: 1, quantidade: 3, preco: 10 }];
  const estado = rateio.aplicar(itens, produto(1));
  assert.equal(estado.totalDistribuido, 1.02);
  assert.equal(estado.diferenca, 0.02);
  assert.deepEqual(itens.map(item => [item.quantidade, item.preco]), [[3, 10.34]]);
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

test('valor menor que um centavo por unidade arredonda todas para R$ 0,01', () => {
  const itens = pedido();
  const estado = rateio.aplicar(itens, produto(0.01));
  assert.equal(estado.acrescimoUnitario, 0.01);
  assert.equal(estado.unidadesCentavoExtra, 0);
  assert.equal(estado.totalDistribuido, 5);
  assert.equal(estado.diferenca, 4.99);
  assert.equal(itens.length, 2);
  assert.deepEqual(itens.map(item => item.preco), [10.01, 20.01]);
  assert.equal(itens.reduce((s, item) => s + item.quantidade, 0), 500);
  rateio.remover(itens, estado);
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


test('R$ 30 em 400 unidades mantém R$ 0,08 em uma linha após recálculos repetidos', () => {
  const itens = [{ item: 1, quantidade: 400, preco: 10 }];
  let estado = rateio.aplicar(itens, produto(30));
  assert.deepEqual(itens.map(item => [item.quantidade, item.preco]), [[400, 10.08]]);
  for (let i = 0; i < 20; i++) {
    estado = rateio.recalcular(itens, estado);
    assert.equal(itens.length, 1);
    assert.equal(estado.totalDistribuido, 32);
    assert.equal(estado.diferenca, 2);
    assert.equal(itens.reduce((s, item) => s + Math.round(item.quantidade * item.preco * 100), 0), 403200);
  }
  const recarregados = semEstadoLocal(itens);
  const persistido = clone(estado);
  rateio.carregar(recarregados, persistido);
  rateio.remover(recarregados, persistido);
  assert.deepEqual(recarregados, [{ item: 1, quantidade: 400, preco: 10 }]);
});

test('novos rateios recusam quantidades fracionárias e bases3dec sem mutação parcial', () => {
  for (const linha of [
    { item: 1, quantidade: 1.5, preco: 10 },
    { item: 1, quantidade: 100, preco: 10.005 }
  ]) {
    const itens = [{ item: 2, quantidade: 100, preco: 20 }, linha];
    const antes = clone(itens);
    assert.throws(() => rateio.aplicar(itens, produto(30)));
    assert.deepEqual(itens, antes);
  }
});

test('carregar antigo aproximado mantém os preços e retirar recupera a base registrada', () => {
  const metadata = {
    versao: 1, produto: produto(), valor: 30, quantidadeTotal: 400,
    acrescimoUnitario: 0.08, totalDistribuido: 32, diferenca: 2,
    linhas: [{ item: 1, quantidade: 400, precoBase: 10, precoAplicado: 10.08, acrescimoUnitario: 0.08 }]
  };
  const itens = [{ item: 1, quantidade: 400, preco: 10.08 }];
  const carregado = rateio.carregar(itens, metadata);
  assert.equal(itens[0].preco, 10.08);
  assert.equal(carregado.totalDistribuido, 32);
  assert.equal(carregado.diferenca, 2);
  rateio.remover(itens, carregado);
  assert.deepEqual(itens, [{ item: 1, quantidade: 400, preco: 10 }]);
  const migrados = [{ item: 1, quantidade: 400, preco: 10.08 }];
  const estado = rateio.carregar(migrados, metadata);
  const novo = rateio.recalcular(migrados, estado);
  assert.equal(novo.totalDistribuido, 32);
  assert.equal(novo.diferenca, 2);
});

test('rateio antigo dividido é preservado ao carregar e reunido ao retirar ou recalcular', () => {
  const metadata = {
    versao: 1, produto: produto(29), valor: 29, quantidadeTotal: 340,
    acrescimoUnitario: 0.08, acrescimoUnitarioMaximo: 0.09, unidadesCentavoExtra: 180,
    totalDistribuido: 29, diferenca: 0,
    linhas: [
      { item: 1, quantidade: 160, precoBase: 10, precoAplicado: 10.08, acrescimoUnitario: 0.08 },
      { item: 1, quantidade: 180, precoBase: 10, precoAplicado: 10.09, acrescimoUnitario: 0.09 }
    ]
  };
  const salvos = [{ item: 1, quantidade: 160, preco: 10.08 }, { item: 1, quantidade: 180, preco: 10.09 }];
  const itens = clone(salvos);
  const carregado = rateio.carregar(itens, metadata);
  assert.deepEqual(semEstadoLocal(itens), salvos);
  assert.equal(carregado.totalDistribuido, 29);
  assert.equal(carregado.diferenca, 0);
  assert.deepEqual(rateio.serializar(itens, carregado), carregado);
  rateio.remover(itens, carregado);
  assert.deepEqual(itens, [{ item: 1, quantidade: 340, preco: 10 }]);

  const recalculados = clone(salvos);
  const estado = rateio.carregar(recalculados, metadata);
  const novo = rateio.recalcular(recalculados, estado);
  assert.deepEqual(semEstadoLocal(recalculados), [{ item: 1, quantidade: 340, preco: 10.09 }]);
  assert.equal(novo.totalDistribuido, 30.6);
  assert.equal(novo.diferenca, 1.6);
  assert.equal(novo.unidadesCentavoExtra, 0);
});

test('bases antigas3dec e pedidos normais3dec são preservados ao retirar', () => {
  const metadata = {
    versao: 1, produto: produto(), valor: 30, quantidadeTotal: 500,
    acrescimoUnitario: 0.06, totalDistribuido: 30, diferenca: 0,
    linhas: [{ item: 1, quantidade: 500, precoBase: 10.005, precoAplicado: 10.065, acrescimoUnitario: 0.06 }]
  };
  const itens = [{ item: 1, quantidade: 500, preco: 10.065 }];
  rateio.carregar(itens, metadata);
  assert.equal(itens[0].preco, 10.065);
  rateio.remover(itens, metadata);
  assert.deepEqual(itens, [{ item: 1, quantidade: 500, preco: 10.005 }]);
  rateio.recalcular(itens, null);
  rateio.remover(itens, null);
  assert.equal(itens[0].preco, 10.005);
});

test('grupoKit e preços negociados diferentes não são mesclados durante rateio', () => {
  const itens = [
    { item: 1, quantidade: 100, preco: 10, grupoKit: 'a' },
    { item: 1, quantidade: 100, preco: 10, grupoKit: 'b' },
    { item: 1, quantidade: 200, preco: 12 }
  ];
  const original = clone(itens);
  let estado = rateio.aplicar(itens, produto(30));
  estado = rateio.recalcular(itens, estado);
  rateio.remover(itens, estado);
  assert.deepEqual(itens, original);
});

test('serializar não muda itens nem recalcula rateio e pedido vazio não lança no render', () => {
  const itens = pedido();
  const estado = rateio.aplicar(itens, produto(30));
  const antes = clone(itens);
  assert.deepEqual(rateio.serializar(itens, estado), estado);
  assert.deepEqual(itens, antes);
  const vazio = [];
  const resumo = rateio.recalcular(vazio, estado);
  assert.equal(resumo.quantidadeTotal, 0);
  assert.equal(resumo.totalDistribuido, 0);
  assert.deepEqual(resumo.linhas, []);
  assert.deepEqual(vazio, []);
});
