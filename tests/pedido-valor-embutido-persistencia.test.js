'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const raiz = path.join(__dirname, '..');
const clonar = valor => JSON.parse(JSON.stringify(valor));

function itens(preco1 = 28.86, preco2 = 35.96) {
  return [
    { item: 10, descricao: 'Produto A', quantidade: 200, preco: preco1 },
    { item: 20, descricao: 'Produto B', quantidade: 300, preco: preco2 }
  ];
}

function metadata() {
  return {
    versao: 1, produto: { id: 7, itemLegado: 70, nome: 'Produto embutido' }, valor: 30,
    quantidadeTotal: 500, acrescimoUnitario: 0.06, totalDistribuido: 30, diferenca: 0,
    linhas: [
      { item: 10, quantidade: 200, precoBase: 28.8, precoAplicado: 28.86, acrescimoUnitario: 0.06 },
      { item: 20, quantidade: 300, precoBase: 35.9, precoAplicado: 35.96, acrescimoUnitario: 0.06 }
    ]
  };
}

function carregar(caminho, dependencias, extras = {}) {
  const modulo = { exports: {} };
  const nomesExtras = Object.keys(extras);
  new Function('require', 'module', 'exports', ...nomesExtras, fs.readFileSync(path.join(raiz, caminho), 'utf8'))(
    nome => {
      assert.ok(Object.hasOwn(dependencias, nome), 'Dependência inesperada: ' + nome);
      return dependencias[nome];
    }, modulo, modulo.exports, ...nomesExtras.map(nome => extras[nome])
  );
  return modulo.exports;
}

function armazenamento(opcoes = {}) {
  const estado = { registros: [], chamadas: [], falharStage: false, falharVinculo: false, ...opcoes };
  let proximo = 1;
  const pool = { query: async (sql, valores = []) => {
    const consulta = sql.replace(/\s+/g, ' ').trim();
    estado.chamadas.push([consulta, clonar(valores)]);
    if (consulta.startsWith('CREATE TABLE')) return { rows: [] };
    if (consulta.startsWith('INSERT INTO')) {
      if (estado.falharStage) throw new Error('Banco indisponível antes de salvar');
      estado.registros.push({ id: valores[0], pedido_ref: valores[1], estado: 'preparado',
        valor_embutido: JSON.parse(valores[2]), itens: JSON.parse(valores[3]),
        valor_embutido_anterior: JSON.parse(valores[4]), itens_anteriores: JSON.parse(valores[5]), ordem: proximo++ });
      return { rows: [], rowCount: 1 };
    }
    if (consulta.startsWith('UPDATE')) {
      const registro = estado.registros.find(item => item.id === valores[0]);
      if (consulta.includes('pedido_ref=$2')) {
        if (estado.falharVinculo) throw new Error('Banco indisponível depois de salvar');
        registro.pedido_ref = valores[1];
        registro.pedido_numero = valores[2];
      }
      registro.estado = consulta.includes("estado='incerto'") ? 'incerto'
        : consulta.includes("estado='nao_aplicado'") ? 'nao_aplicado' : 'aplicado';
      return { rows: [], rowCount: 1 };
    }
    if (consulta.startsWith('SELECT')) {
      return { rows: estado.registros.filter(item => item.pedido_ref === valores[0] && item.estado !== 'nao_aplicado')
        .sort((a, b) => b.ordem - a.ordem).slice(0, 2).map(clonar) };
    }
    throw new Error('Consulta inesperada: ' + consulta);
  } };
  const service = carregar('src/services/legado/pedido/valor-embutido.service.js', {
    'node:crypto': { randomUUID: () => 'operacao-' + proximo },
    '../../../../db/connection': pool
  });
  return { service, estado, pool };
}

function insercao(opcoes = {}) {
  const t = armazenamento(opcoes);
  const chamadasBridge = [];
  const service = carregar('src/services/legado/pedidos-insercao-v2/pedidos-insercao-v2.service.js', {
    '../../produto/produto.service': { buscar: async id => ({ item_legado: id * 10, nome: 'Produto ' + id }) },
    '../clientes/clientes.service': {}, '../../whatsapp/envio-whatsapp.service': {},
    '../../whatsapp/central-controle.service': {}, '../pedido/valor-embutido.service': t.service
  }, {
    process: { env: { LEGADO_BRIDGE_URL: 'https://bridge.test' } },
    fetch: async (url, opcoesFetch) => {
      chamadasBridge.push({ url, payload: JSON.parse(opcoesFetch.body) });
      assert.equal(t.estado.registros[0].estado, 'preparado', 'snapshot persistido deve anteceder o legado');
      if (opcoes.falharBridge) throw new Error('Erro https://provedor.invalid/token/SEGREDO');
      return { ok: true, json: async () => ({ pedido: { idMestre: 99, numero: '0000099', itens: itens() } }) };
    }
  });
  const payload = { favorecido: 123, vendedor: 2, data: '2026-11-23',
    valorEmbutido: metadata(), itens: [
      { produto_id: 1, quantidade: 200, preco: 28.86 },
      { produto_id: 2, quantidade: 300, preco: 35.96 }
    ] };
  return { ...t, serviceInsercao: service, payload, chamadasBridge };
}

function edicao(t, opcoes = {}) {
  const estadoLegado = { itens: itens(28.8, 35.9), chamadas: [], ...opcoes };
  const service = carregar('src/services/legado/pedido/pedidosLegado.service.js', {
    '../legadoBridge.service': {
      get: async () => ({ data: { itens: clonar(estadoLegado.itens) } }),
      put: async (url, payload) => {
        estadoLegado.chamadas.push({ url, payload: clonar(payload) });
        estadoLegado.itens = clonar(payload.itens);
        if (estadoLegado.falharDepoisDeSalvar) throw new Error('Conexão interrompida');
        return { data: { idMestre: 99, numero: '0000099', itens: clonar(payload.itens) } };
      }
    },
    '../../../../db/connection': t.pool,
    '../../whatsapp/envio-whatsapp.service': {}, './pedidoPdf.service': {},
    '../../prestacao_contas/prestacao_contas.service': {},
    '../clientes-creditos/clientes-creditos.service': {}, '../../volume/volume.service': {},
    './valor-embutido.service': t.service
  });
  return { serviceEdicao: service, estadoLegado };
}

test('valida rateio de R$ 30 em 500 unidades e preserva bases independentes', () => {
  const t = armazenamento();
  const valor = t.service.normalizarValorEmbutido(metadata(), itens());
  assert.equal(valor.totalDistribuido, 30);
  assert.equal(valor.acrescimoUnitario, 0.06);
  assert.deepEqual(valor.linhas.map(linha => linha.precoBase), [28.8, 35.9]);
  assert.equal(t.estado.chamadas.length, 0);
});

test('aceita o resultado do cálculo compartilhado com arredondamento visível e preço-base de três casas', () => {
  const calculo = require('../public/js/pedido-valor-embutido');
  const linhas = [
    { item: 10, quantidade: 200, preco: 28.805 },
    { item: 20, quantidade: 299, preco: 35.9 }
  ];
  const valor = calculo.aplicar(linhas, { id: 7, item_legado: 70, nome: 'Produto embutido', preco: 30 });
  const normalizado = armazenamento().service.normalizarValorEmbutido(valor, linhas);
  assert.equal(normalizado.totalDistribuido, 29.94);
  assert.equal(normalizado.diferenca, -0.06);
  assert.equal(normalizado.linhas[0].precoBase, 28.805);
  assert.equal(normalizado.linhas[0].precoAplicado, 28.865);
});

test('rejeita preço ou quantidade divergente antes de persistir ou gravar o pedido', async () => {
  const t = insercao();
  t.payload.itens[0].preco = 28.9;
  await assert.rejects(t.serviceInsercao.inserirPedido(t.payload), /não corresponde ao item 1/);
  assert.equal(t.chamadasBridge.length, 0);
  assert.equal(t.estado.registros.length, 0);
  const invalido = metadata();
  invalido.quantidadeTotal = 2;
  assert.throws(() => t.service.normalizarValorEmbutido(invalido, itens()), /rateio mudou/);
});

test('snapshot é persistido antes da inserção e vinculado ao id real devolvido pelo bridge', async () => {
  const t = insercao();
  const resultado = await t.serviceInsercao.inserirPedido(t.payload);
  assert.equal(t.chamadasBridge.length, 1);
  assert.equal(t.chamadasBridge[0].payload.valorEmbutido, undefined);
  assert.equal(t.chamadasBridge[0].payload.itens[0].preco, 28.86);
  assert.equal(resultado.pedido.idMestre, 99);
  assert.equal(resultado.valorEmbutido.valor, 30);
  assert.equal(t.estado.registros[0].pedido_ref, 99);
  assert.equal(t.estado.registros[0].estado, 'aplicado');
  const relido = await t.service.obterValorEmbutido(99, itens());
  assert.equal(relido.produto.nome, 'Produto embutido');
  assert.deepEqual(relido.linhas.map(linha => linha.precoBase), [28.8, 35.9]);
});

test('banco indisponível ao registrar histórico impede a gravação no legado', async () => {
  const t = insercao({ falharStage: true });
  await assert.rejects(t.serviceInsercao.inserirPedido(t.payload), erro =>
    erro.pedidoNaoGravado === true && /Nenhum pedido foi gravado/.test(erro.message));
  assert.equal(t.chamadasBridge.length, 0);
});

test('falha de associação após salvar não transforma sucesso em tentativa repetível', async () => {
  const t = insercao({ falharVinculo: true });
  const resultado = await t.serviceInsercao.inserirPedido(t.payload);
  assert.equal(resultado.pedido.idMestre, 99);
  assert.match(resultado.avisoValorEmbutido, /Pedido salvo/);
  assert.ok(resultado.operacaoValorEmbutido);
  assert.equal(t.estado.registros.length, 1, 'preços originais continuam duráveis');
  t.estado.falharVinculo = false;
  const relido = await t.service.obterValorEmbutido(99, itens());
  assert.equal(relido.valor, 30);
  assert.equal(t.chamadasBridge.length, 1, 'recuperação nunca repete a inserção');
});

test('resposta interrompida informa resultado incerto sem repetir e sem expor erro de transporte', async () => {
  const t = insercao({ falharBridge: true });
  const resultado = await t.serviceInsercao.inserirPedido(t.payload);
  assert.equal(resultado.salvamentoIncerto, true);
  assert.equal(resultado.pedido, undefined);
  assert.equal(t.chamadasBridge.length, 1);
  assert.equal(t.estado.registros[0].estado, 'incerto');
  assert.equal(t.estado.registros[0].valor_embutido.linhas[0].precoBase, 28.8);
  assert.ok(!JSON.stringify(resultado).includes('SEGREDO'));
});

test('retirada persistida fica nula ao reabrir, conservando histórico dos preços anteriores', async () => {
  const t = armazenamento();
  const aplicado = await t.service.prepararOperacao({ pedidoId: 99, valorEmbutido: metadata(), itens: itens() });
  await t.service.concluirOperacao(aplicado, { idMestre: 99 });
  const retirada = await t.service.prepararOperacao({ pedidoId: 99, valorEmbutido: null, itens: itens(28.8, 35.9) });
  await t.service.concluirOperacao(retirada, { idMestre: 99 });
  assert.equal(await t.service.obterValorEmbutido(99, itens(28.8, 35.9)), null);
  assert.equal(t.estado.registros.length, 2);
  assert.equal(t.estado.registros[0].valor_embutido.valor, 30);
});

test('edição com resposta incerta é reconciliada pela leitura dos itens gravados', async () => {
  const t = armazenamento();
  const aplicado = await t.service.prepararOperacao({ pedidoId: 99, valorEmbutido: metadata(), itens: itens() });
  await t.service.concluirOperacao(aplicado, { idMestre: 99 });
  const retirada = await t.service.prepararOperacao({ pedidoId: 99, valorEmbutido: null, itens: itens(28.8, 35.9) });
  await t.service.marcarIncerto(retirada);
  assert.deepEqual(await t.service.obterValorEmbutido(99, itens()), aplicado.valorEmbutido);
  assert.equal(await t.service.obterValorEmbutido(99, itens(28.8, 35.9)), null);
  assert.equal(t.estado.registros[1].estado, 'aplicado');
});

test('integrações que omitem metadata não podem alterar preços sem preservar o rateio', () => {
  const t = armazenamento();
  assert.doesNotThrow(() => t.service.conferirPreservacao(metadata(), itens()));
  assert.throws(() => t.service.conferirPreservacao(metadata(), itens(10, 20)), /possui valor embutido/);
  assert.doesNotThrow(() => t.service.conferirPreservacao(null, itens(10, 20)));
});

test('primeira aplicação interrompida pode ser descartada ao confirmar que o legado conservou os itens anteriores', async () => {
  const t = armazenamento();
  const aplicado = await t.service.prepararOperacao({ pedidoId: 99, valorEmbutido: metadata(), itens: itens(),
    valorEmbutidoAnterior: null, itensAnteriores: itens(28.8, 35.9) });
  await t.service.marcarIncerto(aplicado);
  assert.equal(await t.service.obterValorEmbutido(99, itens(28.8, 35.9)), null);
  assert.equal(t.estado.registros[0].estado, 'nao_aplicado');
  assert.equal(await t.service.obterValorEmbutido(99, itens(28.8, 35.9)), null);
});

test('edição salva e retira o embutido usando o mesmo PUT e devolve metadata ao reabrir', async () => {
  const t = armazenamento();
  const e = edicao(t);
  const aplicado = await e.serviceEdicao.atualizarPedido(99, { vendedor: 2, itens: itens(), valorEmbutido: metadata() });
  assert.equal(aplicado.valorEmbutido.valor, 30);
  assert.equal(e.estadoLegado.chamadas.length, 1);
  assert.equal(e.estadoLegado.chamadas[0].payload.valorEmbutido, undefined);
  assert.equal(t.estado.registros[0].itens_anteriores[0].preco, 28.8);
  const relido = await e.serviceEdicao.buscarItensPedido(99);
  assert.equal(relido.valorEmbutido.linhas[0].precoBase, 28.8);
  const retirado = await e.serviceEdicao.atualizarPedido(99, { vendedor: 2, itens: itens(28.8, 35.9), valorEmbutido: null });
  assert.equal(retirado.valorEmbutido, null);
  assert.equal((await e.serviceEdicao.buscarItensPedido(99)).valorEmbutido, null);
  assert.equal(e.estadoLegado.chamadas.length, 2);
  assert.equal(e.estadoLegado.itens[0].preco, 28.8);
  assert.equal(e.estadoLegado.itens[1].preco, 35.9);
});

test('edição normal sem embutido não cria histórico nem modifica os itens', async () => {
  const t = armazenamento();
  const e = edicao(t);
  const salvo = await e.serviceEdicao.atualizarPedido(99, { vendedor: 2, itens: itens(28.8, 35.9), valorEmbutido: null });
  assert.equal(salvo.valorEmbutido, null);
  assert.equal(t.estado.registros.length, 0);
  assert.equal(e.estadoLegado.chamadas.length, 1);
  assert.deepEqual(e.estadoLegado.chamadas[0].payload.itens, itens(28.8, 35.9));
});

test('retirada com resposta perdida é recuperada no GET, sem repetir o PUT', async () => {
  const t = armazenamento();
  const e = edicao(t);
  await e.serviceEdicao.atualizarPedido(99, { vendedor: 2, itens: itens(), valorEmbutido: metadata() });
  e.estadoLegado.falharDepoisDeSalvar = true;
  const resultado = await e.serviceEdicao.atualizarPedido(99, { vendedor: 2, itens: itens(28.8, 35.9), valorEmbutido: null });
  assert.equal(resultado.salvamentoIncerto, true);
  assert.equal(e.estadoLegado.chamadas.length, 2);
  const relido = await e.serviceEdicao.buscarItensPedido(99);
  assert.equal(relido.valorEmbutido, null);
  assert.equal(e.estadoLegado.chamadas.length, 2);
});

test('edição sem metadata preserva registro e impede alteração de preço sem rateio e divisão', async () => {
  const t = armazenamento();
  const e = edicao(t);
  await e.serviceEdicao.atualizarPedido(99, { vendedor: 2, itens: itens(), valorEmbutido: metadata() });
  const preservado = await e.serviceEdicao.atualizarPedido(99, { vendedor: 3, itens: itens() });
  assert.equal(preservado.valorEmbutido.valor, 30);
  await assert.rejects(e.serviceEdicao.atualizarPedido(99, { vendedor: 3, itens: itens(10, 20) }), /possui valor embutido/);
  await assert.rejects(e.serviceEdicao.particionarPedido(99, { itens: [] }), /Retire o valor embutido/);
  assert.equal(e.estadoLegado.chamadas.length, 2);
});
