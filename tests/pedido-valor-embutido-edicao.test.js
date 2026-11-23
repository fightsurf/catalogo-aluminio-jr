'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const rateio = require('../public/js/pedido-valor-embutido');

const html = fs.readFileSync(path.join(__dirname, '../views/legado/pedido/pedidos-legado.html'), 'utf8');
const codigo = html.match(/<script>([\s\S]*?)<\/script>/)[1];

function contexto() {
  const elementos = new Map();
  function elemento(id) {
    if (!elementos.has(id)) elementos.set(id, {
      value: '', textContent: '', innerHTML: '', disabled: false, style: {},
      classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
      addEventListener() {}, querySelectorAll() { return []; }, setAttribute() {}, focus() {}
    });
    return elementos.get(id);
  }
  const sandbox = {
    PedidoValorEmbutido: rateio,
    document: { getElementById: elemento, querySelectorAll: () => [], addEventListener() {}, body: { style: {} } },
    window: { addEventListener() {}, confirm: () => true, location: { origin: 'https://example.test', search: '' } },
    URL, URLSearchParams, setTimeout, clearTimeout, console,
    fetch: async () => { throw new Error('Requisição não simulada no teste.'); }
  };
  vm.createContext(sandbox);
  vm.runInContext(codigo, sandbox);
  vm.runInContext(`
    carregarVendedores = async () => {};
    carregarCarradasDisponiveis = async () => {};
    buscarCatalogoAtualEdicao = async () => new Map();
    renderizarPedidoCompleto = () => {};
    renderizarCliente = () => {};
    renderizarItens = () => {};
  `, sandbox);
  return {
    sandbox,
    run: (texto) => vm.runInContext(texto, sandbox),
    read: (texto) => JSON.parse(vm.runInContext(`JSON.stringify(${texto})`, sandbox))
  };
}

async function abrirPedido() {
  const ctx = contexto();
  const itens = [
    { item: 1, descricao: 'Produto A', quantidade: 100, preco: 10 },
    { item: 2, descricao: 'Produto B', quantidade: 400, preco: 20 }
  ];
  const valorEmbutido = rateio.aplicar(itens, { id: 3, item_legado: 3, nome: 'Brinde', preco: 30 });
  ctx.sandbox.pedidoSalvo = {
    idMestre: 7, numero: '7', data: '2026-11-23', vendedor: { favorecido: 9 },
    cliente: {}, carradaAtual: null, valorEmbutido,
    itens: itens.map(({ __valorEmbutido, ...item }) => item)
  };
  ctx.run('pedidoCarregado = pedidoSalvo;');
  await ctx.run('entrarModoEdicao()');
  return ctx;
}

test('reabre pedido salvo, retira acréscimo e cancela sem alterar o pedido carregado', async () => {
  const ctx = await abrirPedido();
  assert.deepEqual(ctx.read('itensEdicao.map(item => item.preco)'), [10.06, 20.06]);
  ctx.run('retirarValorEmbutidoEdicao()');
  assert.deepEqual(ctx.read('itensEdicao.map(item => item.preco)'), [10, 20]);
  assert.equal(ctx.read('valorEmbutidoEdicao'), null);
  assert.deepEqual(ctx.read('pedidoCarregado.itens.map(item => item.preco)'), [10.06, 20.06]);
  ctx.run('sairModoEdicao()');
  await ctx.run('entrarModoEdicao()');
  assert.deepEqual(ctx.read('itensEdicao.map(item => item.preco)'), [10.06, 20.06]);
  assert.equal(ctx.read('valorEmbutidoEdicao.totalDistribuido'), 30);
});

test('importação agrega pela base e recalcula todas as quantidades sem acumular acréscimos', async () => {
  const ctx = await abrirPedido();
  ctx.run("adicionarItemImportadoEdicao({ produto: { item_legado: 1, nome: 'Produto A' }, quantidade: 50, preco: 10 })");
  assert.equal(ctx.read('itensEdicao.filter(item => item.item === 1).reduce((soma, item) => soma + item.quantidade, 0)'), 150);
  assert.equal(ctx.read('valorEmbutidoEdicao.quantidadeTotal'), 550);
  assert.equal(ctx.read('valorEmbutidoEdicao.totalDistribuido'), 33);
  assert.equal(ctx.read('valorEmbutidoEdicao.diferenca'), 3);
  assert.deepEqual(ctx.read('itensEdicao.map(item => item.preco)'), [10.06, 20.06]);
  assert.equal(Math.round(ctx.read('totalPedidoAtual()') * 100), 953300);
  ctx.run('retirarValorEmbutidoEdicao()');
  assert.ok(ctx.read('itensEdicao.every(item => item.preco === (item.item === 1 ? 10 : 20))'));
  assert.equal(ctx.read('totalPedidoAtual()'), 9500);
});

test('atualizar cadastro mantém rateio e retirada preserva o novo preço-base', async () => {
  const ctx = await abrirPedido();
  ctx.run('buscarCatalogoAtualEdicao = async () => new Map([[1, { preco: 12 }], [2, { preco: 21 }]])');
  await ctx.run('atualizarPrecosEdicao()');
  assert.deepEqual(ctx.read('itensEdicao.map(item => item.preco)'), [12.06, 21.06]);
  ctx.run('retirarValorEmbutidoEdicao()');
  assert.deepEqual(ctx.read('itensEdicao.map(item => item.preco)'), [12, 21]);
});

test('salvar retirada envia preços restaurados e valorEmbutido null ao mesmo PUT', async () => {
  const ctx = await abrirPedido();
  ctx.run(`
    globalThis.requisicoes = [];
    fetchJson = async (url, options) => {
      const payload = JSON.parse(options.body);
      requisicoes.push({url, method: options.method, payload});
      return {data: { ...pedidoCarregado, ...payload, total: 9000 }};
    };
    retirarValorEmbutidoEdicao();
  `);
  await ctx.run('salvarAlteracoesPedido()');
  const requisicoes = ctx.read('requisicoes');
  assert.equal(requisicoes.length, 1);
  assert.equal(requisicoes[0].url, '/api/legado/pedidos/7');
  assert.equal(requisicoes[0].method, 'PUT');
  assert.equal(requisicoes[0].payload.valorEmbutido, null);
  assert.deepEqual(requisicoes[0].payload.itens.map(item => item.preco), [10, 20]);
  assert.equal(ctx.read('modoEdicao'), false);
  assert.equal(ctx.read('pedidoCarregado.valorEmbutido'), null);
});

test('resultado incerto preserva rascunho e impede repetir o salvamento', async () => {
  const ctx = await abrirPedido();
  ctx.run(`
    globalThis.tentativas = 0;
    fetchJson = async () => { tentativas++; return {salvamentoIncerto: true}; };
  `);
  await ctx.run('salvarAlteracoesPedido()');
  assert.equal(ctx.read('salvamentoIncertoEdicao'), true);
  assert.equal(ctx.read('modoEdicao'), true);
  assert.equal(ctx.read('itensEdicao.length'), 2);
  await ctx.run('salvarAlteracoesPedido()');
  assert.equal(ctx.read('tentativas'), 1);
});

test('perda da conexão, JSON incompleto e erro de gateway preservam rascunho e bloqueiam nova tentativa', async () => {
  for (const resposta of ['conexao', 'json', 'gateway']) {
    const ctx = await abrirPedido();
    let tentativas = 0;
    ctx.sandbox.fetch = async () => {
      tentativas++;
      if (resposta === 'conexao') throw new TypeError('Failed to fetch');
      return {
        ok: resposta !== 'gateway', status: resposta === 'gateway' ? 502 : 200,
        json: async () => { if (resposta === 'json') throw new SyntaxError('JSON truncado'); return {}; }
      };
    };
    await ctx.run('salvarAlteracoesPedido()');
    assert.equal(ctx.read('salvamentoIncertoEdicao'), true, resposta);
    assert.equal(ctx.read('modoEdicao'), true, resposta);
    assert.deepEqual(ctx.read('itensEdicao.map(item => item.preco)'), [10.06, 20.06]);
    await ctx.run('salvarAlteracoesPedido()');
    assert.equal(tentativas, 1, resposta);
  }
});

test('erro de validação permite corrigir o rascunho sem indicar salvamento incerto', async () => {
  const ctx = await abrirPedido();
  ctx.sandbox.fetch = async () => ({ ok: false, status: 400, json: async () => ({ success: false, message: 'Corrija o preço.' }) });
  await ctx.run('salvarAlteracoesPedido()');
  assert.equal(ctx.read('salvamentoIncertoEdicao'), false);
  assert.equal(ctx.read('modoEdicao'), true);
});

test('valor inferior a um centavo médio por unidade grava o total uniforme arredondado para cima', async () => {
  const ctx = await abrirPedido();
  ctx.run(`
    globalThis.requisicoes = [];
    fetchJson = async (url, options) => {
      const payload = JSON.parse(options.body);
      requisicoes.push({url, payload});
      return { data: { ...pedidoCarregado, ...payload, total: 108104 } };
    };
  `);
  ctx.run('itensEdicao[0].quantidade = 10000; recalcularValorEmbutidoEdicao()');
  assert.equal(ctx.read('valorEmbutidoEdicao.totalDistribuido'), 104);
  assert.equal(ctx.read('valorEmbutidoEdicao.diferenca'), 74);
  assert.equal(ctx.read('valorEmbutidoEdicao.quantidadeTotal'), 10400);
  await ctx.run('salvarAlteracoesPedido()');
  const requisicoes = ctx.read('requisicoes');
  assert.equal(requisicoes.length, 1);
  assert.equal(requisicoes[0].payload.valorEmbutido.valor, 30);
  assert.equal(requisicoes[0].payload.valorEmbutido.totalDistribuido, 104);
  assert.equal(requisicoes[0].payload.itens.length, 2);
  assert.deepEqual(requisicoes[0].payload.itens.map(item => item.preco), [10.01, 20.01]);
  assert.equal(Math.round(requisicoes[0].payload.itens.reduce((soma, item) => soma + item.quantidade * item.preco, 0) * 100), 10810400);
  assert.equal(ctx.read('salvamentoIncertoEdicao'), false);
});

test('não salva enquanto uma importação ou atualização de preços está pendente', async () => {
  const ctx = await abrirPedido();
  let tentativas = 0;
  ctx.sandbox.fetch = async () => { tentativas++; throw new Error('Não deve gravar.'); };
  ctx.run('importandoRelatorio = true');
  await ctx.run('salvarAlteracoesPedido()');
  ctx.run('importandoRelatorio = false; atualizandoPrecosEdicao = true');
  await ctx.run('salvarAlteracoesPedido()');
  assert.equal(tentativas, 0);
});

test('painel informa arredondamento e escapa o nome do produto', async () => {
  const ctx = await abrirPedido();
  const painel = ctx.run("montarPainelValorEmbutido({produto:{nome:'<Brinde>'},valor:30,acrescimoUnitario:0.05,totalDistribuido:27.5,quantidadeTotal:550,diferenca:-2.5},true)");
  assert.match(painel, /&lt;Brinde&gt;/);
  assert.match(painel, /Diferença de arredondamento/);
  assert.match(painel, /Retirar produto embutido/);
});

test('painel descreve o acréscimo uniforme e o excedente do arredondamento', () => {
  const ctx = contexto();
  const itens = [{ item: 1, descricao: 'Produto', quantidade: 400, preco: 10 }];
  ctx.sandbox.metadata = rateio.aplicar(itens, { id: 3, nome: '<Brinde>', preco: 30 });
  const painel = ctx.run('montarPainelValorEmbutido(metadata, true)');
  assert.match(painel, /&lt;Brinde&gt;/);
  assert.match(painel, /R\$\s*0,08/);
  assert.match(painel, /R\$\s*32,00/);
  assert.match(painel, /R\$\s*2,00/);
  assert.doesNotMatch(painel, /0,07|200 unidades/);
  assert.equal(itens.length, 1);
  assert.equal(Math.round(itens.reduce((soma, item) => soma + item.quantidade * item.preco, 0) * 100), 403200);
});

test('abrir rateio antigo preserva preços gravados e permite retirar o acréscimo original', async () => {
  const ctx = contexto();
  ctx.sandbox.pedidoAntigo = {
    idMestre: 7, numero: '7', data: '2026-11-23', vendedor: { favorecido: 9 }, cliente: {}, carradaAtual: null,
    itens: [{ item: 1, descricao: 'Produto', quantidade: 400, preco: 10.08 }],
    valorEmbutido: {
      versao: 1, produto: { id: 3, nome: 'Brinde' }, valor: 30,
      quantidadeTotal: 400, acrescimoUnitario: 0.08, totalDistribuido: 32, diferenca: 2,
      linhas: [{ item: 1, quantidade: 400, precoBase: 10, precoAplicado: 10.08, acrescimoUnitario: 0.08 }]
    }
  };
  ctx.run('pedidoCarregado = pedidoAntigo');
  await ctx.run('entrarModoEdicao()');
  assert.equal(ctx.read('totalPedidoAtual()'), 4032);
  assert.equal(ctx.read('valorEmbutidoEdicao.totalDistribuido'), 32);
  ctx.run('retirarValorEmbutidoEdicao()');
  assert.equal(ctx.read('totalPedidoAtual()'), 4000);
});

test('edição de pedido antigo dividido preserva o salvo e só uniformiza ao recalcular', async () => {
  const ctx = contexto();
  ctx.sandbox.pedidoAntigo = {
    idMestre: 7, numero: '7', data: '2026-11-23', vendedor: { favorecido: 9 }, cliente: {}, carradaAtual: null,
    itens: [
      { item: 1, descricao: 'Produto', quantidade: 160, preco: 10.08 },
      { item: 1, descricao: 'Produto', quantidade: 180, preco: 10.09 }
    ],
    valorEmbutido: {
      versao: 1, produto: { id: 3, nome: 'Brinde' }, valor: 29,
      quantidadeTotal: 340, acrescimoUnitario: 0.08, acrescimoUnitarioMaximo: 0.09,
      unidadesCentavoExtra: 180, totalDistribuido: 29, diferenca: 0,
      linhas: [
        { item: 1, quantidade: 160, precoBase: 10, precoAplicado: 10.08, acrescimoUnitario: 0.08 },
        { item: 1, quantidade: 180, precoBase: 10, precoAplicado: 10.09, acrescimoUnitario: 0.09 }
      ]
    }
  };
  ctx.run(`
    pedidoCarregado = pedidoAntigo;
    globalThis.requisicoes = [];
    fetchJson = async (url, options) => {
      const payload = JSON.parse(options.body);
      requisicoes.push({url, payload});
      return { data: { ...pedidoCarregado, ...payload, total: 3429 } };
    };
  `);
  await ctx.run('entrarModoEdicao()');
  assert.deepEqual(ctx.read('itensEdicao.map(item => [item.quantidade, item.preco])'), [[160, 10.08], [180, 10.09]]);
  assert.equal(Math.round(ctx.read('totalPedidoAtual()') * 100), 342900);
  const painel = ctx.run('montarPainelValorEmbutido(valorEmbutidoEdicao, true)');
  assert.match(painel, /160 unidades com R\$\s*0,08/);
  assert.match(painel, /180 unidades com R\$\s*0,09/);
  await ctx.run('salvarAlteracoesPedido()');
  const payload = ctx.read('requisicoes[0].payload');
  assert.equal(payload.itens.length, 2);
  assert.equal(payload.valorEmbutido.totalDistribuido, 29);
  assert.equal(payload.valorEmbutido.diferenca, 0);

  await ctx.run('entrarModoEdicao()');
  ctx.run('recalcularValorEmbutidoEdicao()');
  assert.deepEqual(ctx.read('itensEdicao.map(item => [item.quantidade, item.preco])'), [[340, 10.09]]);
  assert.equal(ctx.read('valorEmbutidoEdicao.totalDistribuido'), 30.6);
  assert.equal(ctx.read('valorEmbutidoEdicao.diferenca'), 1.6);
  ctx.run('retirarValorEmbutidoEdicao()');
  assert.deepEqual(ctx.read('itensEdicao.map(item => [item.quantidade, item.preco])'), [[340, 10]]);
  assert.equal(ctx.read('totalPedidoAtual()'), 3400);
});

test('atualizar preços informa a diferença real e preserva o acréscimo uniforme arredondado', async () => {
  const ctx = contexto();
  const itens = [{ item: 1, descricao: 'Produto', quantidade: 400, preco: 10 }];
  const metadata = rateio.aplicar(itens, { id: 3, nome: 'Brinde', preco: 30 });
  ctx.sandbox.pedidoSalvo = {
    idMestre: 7, numero: '7', data: '2026-11-23', vendedor: { favorecido: 9 }, cliente: {}, carradaAtual: null,
    itens: itens.map(({ __valorEmbutido, ...item }) => item), valorEmbutido: metadata
  };
  ctx.run(`
    pedidoCarregado = pedidoSalvo;
    globalThis.confirmacoes = [];
    window.confirm = mensagem => { confirmacoes.push(mensagem); return true; };
    buscarCatalogoAtualEdicao = async () => new Map([[1, { preco: 12 }]]);
  `);
  await ctx.run('entrarModoEdicao()');
  await ctx.run('atualizarPrecosEdicao()');
  assert.equal(Math.round(ctx.read('totalPedidoAtual()') * 100), 483200);
  assert.equal(ctx.read('valorEmbutidoEdicao.totalDistribuido'), 32);
  assert.match(ctx.read('confirmacoes[0]'), /R\$\s*800,00/);
  ctx.run('retirarValorEmbutidoEdicao()');
  assert.equal(ctx.read('totalPedidoAtual()'), 4800);
});

test('importação com quantidade fracionada não deixa rateio parcialmente alterado', async () => {
  const ctx = await abrirPedido();
  const antes = ctx.read('itensEdicao');
  assert.throws(() => ctx.run("adicionarItemImportadoEdicao({ produto: { item_legado: 1, nome: 'Produto A' }, quantidade: 0.5, preco: 10 })"), /inteir/);
  assert.deepEqual(ctx.read('itensEdicao'), antes);
  assert.equal(ctx.read('valorEmbutidoEdicao.totalDistribuido'), 30);
});
