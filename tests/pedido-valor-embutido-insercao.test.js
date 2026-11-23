'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const rateio = require('../public/js/pedido-valor-embutido');
const html = fs.readFileSync(path.join(__dirname, '../views/legado/pedidos-insercao-v2/pedidos-insercao-v2.html'), 'utf8');
const codigo = html.match(/<script>([\s\S]*?)<\/script>/)[1];

async function contexto() {
  const elementos = new Map();
  function elemento(id) {
    if (!elementos.has(id)) elementos.set(id, {
      value: '', textContent: '', innerHTML: '', disabled: false, hidden: false, style: {}, handlers: {},
      classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
      addEventListener(nome, fn) { this.handlers[nome] = fn; },
      querySelectorAll() { return []; }, setAttribute() {}, focus() {}, contains() { return false; }
    });
    return elementos.get(id);
  }
  const sandbox = {
    PedidoValorEmbutido: rateio,
    document: { getElementById: elemento, querySelectorAll: () => [], addEventListener() {} },
    window: { addEventListener() {}, confirm: () => true, location: { origin: 'https://example.test', search: '' } },
    URL, URLSearchParams, setTimeout, clearTimeout, console,
    fetch: async () => ({ok: true, status: 200, json: async () => ({data: [], dados: []})})
  };
  vm.createContext(sandbox);
  vm.runInContext(codigo, sandbox);
  await new Promise(setImmediate);
  const run = texto => vm.runInContext(texto, sandbox);
  run(`
    clienteSelecionado = { favorecido: 42, nome: 'Cliente teste' };
    vendedores = [{ favorecido: 7, nome: 'Vendedor teste' }];
    vendedorPedido.value = '7';
    volumesPedido.value = '0';
    itensPedido = [
      { produto_id: 1, item_legado: 101, nome: 'Produto A', quantidade: 100, preco: 10, precoMinimo: 10 },
      { produto_id: 2, item_legado: 102, nome: 'Produto B', quantidade: 400, preco: 20, precoMinimo: 20 }
    ];
    produtoEmbutidoSelecionado = { id: 3, item_legado: 103, nome: 'Brinde', preco: 30 };
    conferirPrecosMinimosAntesDeSalvar = async () => ({corrigidos: [], abaixoDoMinimoManuais: []});
    renderItensPedido();
  `);
  elemento('btnAplicarValorEmbutido').handlers.click();
  return {sandbox, elementos, elemento, run,
    read: texto => JSON.parse(run(`JSON.stringify(${texto})`))};
}

test('antes de salvar soma 500 unidades no rodapé e embute R$ 0,06 em todos os preços', async () => {
  const ctx = await contexto();
  assert.match(ctx.elemento('tabelaItensWrap').innerHTML, /<tfoot>[\s\S]*Total de itens[\s\S]*id="totalItensPedido"[^>]*>500</);
  assert.deepEqual(ctx.read('itensPedido.map(item => item.preco)'), [10.06, 20.06]);
  assert.equal(ctx.read('calcularTotal()'), 9030);
  assert.equal(ctx.read('ultimoPedidoSalvo'), null);
  assert.equal(ctx.elemento('btnEmbutirValor').disabled, false);
  const payload = ctx.read('montarPayload()');
  assert.equal(payload.valorEmbutido.totalDistribuido, 30);
  assert.deepEqual(payload.itens.map(item => item.preco), [10.06, 20.06]);
});

test('retirada antes de salvar desfaz acréscimo e preserva quantidades', async () => {
  const ctx = await contexto();
  ctx.elemento('btnRetirarValorEmbutido').handlers.click();
  assert.deepEqual(ctx.read('itensPedido.map(item => item.preco)'), [10, 20]);
  assert.deepEqual(ctx.read('itensPedido.map(item => item.quantidade)'), [100, 400]);
  assert.equal(ctx.read('montarPayload().valorEmbutido'), null);
  assert.equal(ctx.read('calcularTotal()'), 9000);
});

test('novas quantidades e adição do mesmo produto recalculam sem acumular o rateio', async () => {
  const ctx = await contexto();
  ctx.run("adicionarItemNormalizado({produto:{id:1,item_legado:101,nome:'Produto A',preco:10},quantidade:500,preco:10}); renderItensPedido()");
  assert.equal(ctx.read('itensPedido.length'), 2);
  assert.equal(ctx.read('valorEmbutido.quantidadeTotal'), 1000);
  assert.deepEqual(ctx.read('itensPedido.map(item => item.preco)'), [10.03, 20.03]);
  assert.equal(ctx.read('valorEmbutido.totalDistribuido'), 30);
});

test('salvamento envia metadata com os preços e limpa o rascunho somente após resposta confirmada', async () => {
  const ctx = await contexto();
  const requisicoes = [];
  ctx.sandbox.fetch = async (url, options) => {
    const payload = JSON.parse(options.body);
    requisicoes.push({url, payload});
    return {ok:true, status:201, json:async()=>({pedido:{idMestre:1001,saida:1001,numero:'TESTE001',total:payload.total}})};
  };
  await ctx.run('salvarPedido()');
  assert.equal(requisicoes.length, 1);
  assert.equal(requisicoes[0].url, '/api/legado/pedidos-insercao-v2');
  assert.equal(requisicoes[0].payload.valorEmbutido.totalDistribuido, 30);
  assert.equal(requisicoes[0].payload.total, 9030);
  assert.equal(ctx.read('itensPedido.length'), 0);
  assert.equal(ctx.read('valorEmbutido'), null);
  assert.equal(ctx.read('ultimoPedidoSalvo.numero'), 'TESTE001');
  assert.equal(ctx.read('ultimoPedidoSalvo.total'), 9030);
});

test('resposta vazia, conexão interrompida e gateway preservam o rascunho e impedem duplicação', async () => {
  for (const caso of ['vazia', 'conexao', 'gateway', 'incerto']) {
    const ctx = await contexto();
    let chamadas = 0;
    ctx.sandbox.fetch = async () => {
      chamadas++;
      if (caso === 'conexao') throw new Error('Conexão interrompida');
      return {ok:caso !== 'gateway',status:caso === 'gateway'?502:200,
        json:async()=>caso === 'incerto'?{salvamentoIncerto:true}: {}};
    };
    await ctx.run('salvarPedido()');
    assert.equal(ctx.read('salvamentoIncerto'), true, caso);
    assert.equal(ctx.read('itensPedido.length'), 2, caso);
    assert.equal(ctx.read('valorEmbutido.valor'), 30, caso);
    assert.equal(ctx.read('ultimoPedidoSalvo'), null, caso);
    await ctx.run('salvarPedido()');
    assert.equal(chamadas, 1, caso);
  }
});

test('falha confirmada antes da gravação permite corrigir sem perder o rateio', async () => {
  const ctx = await contexto();
  ctx.sandbox.fetch = async () => ({ok:false,status:503,json:async()=>({pedidoNaoGravado:true,detalhe:'Histórico indisponível.'})});
  await ctx.run('salvarPedido()');
  assert.equal(ctx.read('salvamentoIncerto'), false);
  assert.equal(ctx.read('itensPedido.length'), 2);
  assert.equal(ctx.read('valorEmbutido.valor'), 30);
});

test('aguarda importação pendente antes de gravar', async () => {
  const ctx = await contexto();
  let chamadas = 0;
  ctx.sandbox.fetch = async () => { chamadas++; throw new Error('Não deve gravar.'); };
  ctx.elemento('btnImportarRelatorio').disabled = true;
  await ctx.run('salvarPedido()');
  assert.equal(chamadas, 0);
  assert.equal(ctx.read('ultimoPedidoSalvo'), null);
});

test('R$ 30 em 400 unidades fecha o valor com dois preços em vez de cobrar R$ 32', async () => {
  const ctx = await contexto();
  ctx.run('itensPedido[1].quantidade = 300; renderItensPedido()');
  const payload = ctx.read('montarPayload()');
  assert.equal(payload.total, 7030);
  assert.equal(payload.valorEmbutido.totalDistribuido, 30);
  assert.equal(payload.valorEmbutido.diferenca, 0);
  assert.equal(payload.itens.reduce((s, i) => s + i.quantidade, 0), 400);
  assert.equal(payload.itens.reduce((s, i) => s + Math.round(i.preco * 100) * i.quantidade, 0), 703000);
  assert.match(ctx.elemento('resumoValorEmbutido').innerHTML, /0,07/);
  assert.match(ctx.elemento('resumoValorEmbutido').innerHTML, /0,08/);
  ctx.elemento('btnRetirarValorEmbutido').handlers.click();
  assert.equal(ctx.read('calcularTotal()'), 7000);
  assert.equal(ctx.read('itensPedido.reduce((s, i) => s + i.quantidade, 0)'), 400);
});

test('valor inferior a um centavo por unidade continua integralmente distribuído e pode ser salvo', async () => {
  const ctx = await contexto();
  ctx.run('itensPedido[0].quantidade = 10000; renderItensPedido()');
  const payload = ctx.read('montarPayload()');
  assert.equal(payload.total, 108030);
  assert.equal(payload.valorEmbutido.totalDistribuido, 30);
  assert.equal(payload.valorEmbutido.diferenca, 0);
  assert.equal(payload.itens.reduce((s, i) => s + i.quantidade, 0), 10400);
  let chamadas = 0;
  ctx.sandbox.fetch = async (url, options) => {
    chamadas++;
    const dados = JSON.parse(options.body);
    assert.equal(dados.total, 108030);
    return {ok:true,status:201,json:async()=>({pedido:{idMestre:1002,numero:'TESTE002',total:dados.total}})};
  };
  await ctx.run('salvarPedido()');
  assert.equal(chamadas, 1);
  assert.equal(ctx.read('ultimoPedidoSalvo.total'), 108030);
});
