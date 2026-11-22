'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const eloise = { favorecido: 12, nome: 'Eloise Karine', cidade: 'Santana do Matos', uf: 'RN' };
function pedido(id, extra = {}) {
  return {
    idMestre: id, saida: id, numero: String(20000 + id).padStart(7, '0'),
    data: '2026-11-22', situacao: 'A', cliente: eloise,
    total: 1795, vendedor: { nome: 'George' },
    dataExpedicao: null, dataExpedicaoDisponivel: true, ...extra
  };
}
function carregarServico(opcoes = {}) {
  const source = fs.readFileSync(path.join(__dirname, '../src/services/integracao/mcpConsultaPedidos.service.js'), 'utf8');
  const chamados = [];
  const registros = opcoes.registros || [pedido(101), pedido(102)];
  const cadastros = opcoes.clientes || [eloise];
  const deps = {
    '../legado/pedido/pedidosLegado.service': {
      pesquisarPedidos: async filtros => { chamados.push(['pesquisa', filtros]); return registros; },
      buscarDetalhePedido: async id => {
        chamados.push(['detalhe', id]);
        if (opcoes.falharDetalhe) throw new Error('bridge indisponível');
        return opcoes.detalhes ? opcoes.detalhes[id] || null : registros.find(p => p.idMestre === id) || null;
      }
    },
    '../legado/clientes/clientes.service': {
      listarClientes: async filtros => { chamados.push(['clientes', filtros]); return cadastros; },
      buscarCliente: async id => { chamados.push(['cliente', id]); return cadastros.find(c => Number(c.favorecido) === id) || null; }
    },
    '../legado/pedidos-cliente/pedidos-cliente.service': {
      listarPedidosPorCliente: async id => {
        chamados.push(['historico', id]);
        return opcoes.respostaHistorico || { cliente: eloise, dados: registros };
      }
    },
    '../legado/carradas/carradas.service': {
      buscarResumoCarrada: async codigo => {
        chamados.push(['carrada', codigo]);
        if (opcoes.falharCarrada) throw new Error('carrada indisponível');
        return opcoes.carradas?.[codigo] || null;
      }
    }
  };
  const m = { exports: {} };
  new Function('require', 'module', 'exports', source)(name => {
    assert.ok(deps[name], 'dependência inesperada: ' + name);
    return deps[name];
  }, m, m.exports);
  return { service: m.exports, chamados };
}

test('consulta exige filtros, tipos e paginação válidos antes de acessar origem', async () => {
  const { service, chamados } = carregarServico();
  for (const [args, mensagem] of [
    [{}, /Informe o número/],
    [{ cliente: 'Cliente', limite: 100 }, /Limite/],
    [{ data: '2026-02-30' }, /Data inválida/],
    [{ cliente: 'Eloise', pagina: 0 }, /Página/],
    [{ cliente: 'Eloise', ultimo: true, pagina: 2 }, /página 1/],
    [{ cliente: 'Eloise', sem_data_expedicao: 'true' }, /booleano/],
    [{ numero: 21 }, /Filtro inválido/],
    [{ cliente: 'El' }, /três caracteres/]
  ]) await assert.rejects(service.consultarPedidos(args), mensagem);
  assert.deepEqual(chamados, []);
});

test('busca por número aplica prefixo mesmo se a origem ignorar o filtro', async () => {
  const { service, chamados } = carregarServico({
    registros: [pedido(20), pedido(21, { carradaAtual: { codigo: 1697, data: '2026-12-02' } })]
  });
  const r = await service.consultarPedidos({ numero: '0020021' });
  assert.equal(r.pedidos.length, 1);
  assert.equal(r.pedidos[0].numero, '0020021');
  assert.equal(r.pedidos[0].carrada.codigo, 1697);
  assert.equal(r.somente_leitura, true);
  assert.equal(chamados[0][1].numero, '0020021');
});

test('nome exato identifica código e usa histórico do cliente em vez de pesquisa limitada', async () => {
  const { service, chamados } = carregarServico({
    clientes: [eloise, { favorecido: 13, nome: 'Eloise Karine de Souza' }]
  });
  const r = await service.consultarPedidos({ cliente: 'Éloise  Karine' });
  assert.equal(r.cliente.favorecido, 12);
  assert.ok(chamados.some(c => c[0] === 'historico' && c[1] === 12));
  assert.ok(!chamados.some(c => c[0] === 'pesquisa'));
});

test('nome ambíguo pede escolha e não mistura pedidos de clientes diferentes', async () => {
  const { service, chamados } = carregarServico({
    clientes: [eloise, { favorecido: 13, nome: 'Eloise Karine de Souza' }]
  });
  const r = await service.consultarPedidos({ cliente: 'Eloise' });
  assert.equal(r.necessita_escolha_cliente, true);
  assert.equal(r.total_clientes, 2);
  assert.equal(r.pedidos.length, 0);
  assert.ok(!chamados.some(c => c[0] === 'historico'));
});

test('cadastros com nomes iguais continuam exigindo código', async () => {
  const { service } = carregarServico({ clientes: [eloise, { ...eloise, favorecido: 13 }] });
  const r = await service.consultarPedidos({ cliente: 'Eloise Karine' });
  assert.equal(r.necessita_escolha_cliente, true);
});

test('código de cliente seleciona identidade e recusa nome divergente', async () => {
  const { service, chamados } = carregarServico();
  const r = await service.consultarPedidos({ favorecido: 12 });
  assert.equal(r.cliente.nome, 'Eloise Karine');
  assert.ok(chamados.some(c => c[0] === 'historico' && c[1] === 12));
  await assert.rejects(service.consultarPedidos({ favorecido: 12, cliente: 'Maria' }), /não corresponde/);
  await assert.rejects(service.consultarPedidos({ favorecido: '12' }), /código inteiro/);
});

test('histórico com mais de 300 pedidos é paginado até o registro mais antigo', async () => {
  const registros = Array.from({ length: 350 }, (_, i) => pedido(i + 1));
  const { service, chamados } = carregarServico({ registros });
  const r = await service.consultarPedidos({ cliente: 'Eloise Karine', pagina: 12, limite: 30 });
  assert.equal(r.encontrados, 350);
  assert.equal(r.exibindo, 20);
  assert.equal(r.pedidos[0].id_mestre, 20);
  assert.equal(r.pedidos.at(-1).id_mestre, 1);
  assert.equal(r.tem_mais, false);
  assert.equal(r.proxima_pagina, null);
  assert.equal(r.resultado_completo, true);
  assert.ok(!chamados.some(c => c[0] === 'pesquisa'));
  const primeira = await service.consultarPedidos({ favorecido: 12, pagina: 1, limite: 30 });
  assert.equal(primeira.tem_mais, true);
  assert.equal(primeira.proxima_pagina, 2);
  assert.equal(primeira.pedidos[0].id_mestre, 350);
});

test('histórico rejeita identidade divergente no cabeçalho ou em um pedido', async () => {
  for (const respostaHistorico of [
    { cliente: { favorecido: 99 }, dados: [pedido(1)] },
    { cliente: eloise, dados: [pedido(1, { cliente: { favorecido: 99 } })] }
  ]) {
    const { service } = carregarServico({ respostaHistorico });
    await assert.rejects(service.consultarPedidos({ favorecido: 12 }), /outro cliente|clientes diferentes/);
  }
});

test('último cadastrado segue id interno e não data comercial ou expedição', async () => {
  const { service } = carregarServico({
    registros: [
      pedido(2, { data: '2026-12-20', dataExpedicao: '2026-12-21' }),
      pedido(3, { data: '2026-01-01', dataExpedicao: null }),
      pedido(1, { data: '2026-12-31' })
    ]
  });
  const r = await service.consultarPedidos({ cliente: 'Eloise Karine', ultimo: true });
  assert.deepEqual(r.pedidos.map(p => p.id_mestre), [3]);
  assert.equal(r.ultimo_pedido_confirmado, true);
  assert.equal(r.tem_mais, false);
  assert.equal(r.limite, 1);
});

test('sem expedição distingue null explícito, vazio, data e campo desconhecido', async () => {
  const { service } = carregarServico({
    registros: [
      pedido(1), pedido(2, { dataExpedicao: '22/11/2026' }),
      pedido(3, { dataExpedicao: null, dataExpedicaoDisponivel: false }),
      pedido(4, { dataExpedicao: '   ' })
    ],
    detalhes: {}
  });
  const r = await service.consultarPedidos({ cliente: 'Eloise Karine', sem_data_expedicao: true });
  assert.deepEqual(r.pedidos.map(p => p.id_mestre), [4, 1]);
  assert.ok(r.pedidos.every(p => p.sem_data_expedicao === true));
  assert.equal(r.expedicao_nao_verificada, 1);
  assert.equal(r.resultado_completo, false);
  assert.match(r.avisos.join(' '), /não foram classificados como sem data/);
});

test('filtro sem expedição combinado com último e cancelamento usa os filtros antes do limite', async () => {
  const { service } = carregarServico({
    registros: [
      pedido(10, { dataExpedicao: '2026-11-22' }),
      pedido(9, { situacao: 'C' }), pedido(8), pedido(7)
    ]
  });
  const r = await service.consultarPedidos({
    cliente: 'Eloise Karine', ultimo: true, sem_data_expedicao: true, incluir_cancelados: false
  });
  assert.deepEqual(r.pedidos.map(p => p.id_mestre), [8]);
  assert.equal(r.encontrados, 2);
  assert.equal(r.ultimo_pedido_confirmado, true);
});

test('expedição ausente no histórico é lida da carrada existente uma vez por código', async () => {
  const registros = [
    pedido(1, { dataExpedicaoDisponivel: false, carradaCodigo: 1697 }),
    pedido(2, { dataExpedicaoDisponivel: false, carradaCodigo: 1697 }),
    pedido(3, { dataExpedicaoDisponivel: false, carradaCodigo: 1697 })
  ];
  const { service, chamados } = carregarServico({
    registros, carradas: { 1697: { pedidos: [
      { saida: 1, numero: registros[0].numero, dataExpedicao: null },
      { saida: 2, numero: registros[1].numero, dataExpedicao: '2026-11-21' },
      { saida: 3, numero: registros[2].numero, dataExpedicao: null }
    ] } }
  });
  const r = await service.consultarPedidos({ cliente: 'Eloise Karine', sem_data_expedicao: true });
  assert.deepEqual(r.pedidos.map(p => p.id_mestre), [3, 1]);
  assert.equal(r.resultado_completo, true);
  assert.equal(chamados.filter(c => c[0] === 'carrada').length, 1);
  assert.equal(chamados.filter(c => c[0] === 'detalhe').length, 0);
});

test('carrada não usa data de outro pedido com número igual e id diferente', async () => {
  const registros = [pedido(1, { dataExpedicaoDisponivel: false, carradaCodigo: 1697 })];
  const { service } = carregarServico({
    registros, detalhes: {}, carradas: { 1697: { pedidos: [
      { saida: 999, numero: registros[0].numero, dataExpedicao: null }
    ] } }
  });
  const r = await service.consultarPedidos({ cliente: 'Eloise Karine', sem_data_expedicao: true });
  assert.equal(r.pedidos.length, 0);
  assert.equal(r.expedicao_nao_verificada, 1);
});

test('falha na leitura da expedição não equivale a data vazia', async () => {
  const { service } = carregarServico({
    registros: [pedido(1, { dataExpedicaoDisponivel: false, carradaCodigo: 1697 })],
    falharCarrada: true, falharDetalhe: true
  });
  const r = await service.consultarPedidos({ cliente: 'Eloise Karine', sem_data_expedicao: true, ultimo: true });
  assert.equal(r.pedidos.length, 0);
  assert.equal(r.resultado_completo, false);
  assert.equal(r.ultimo_pedido_confirmado, false);
});

test('sinais de corte da origem são visíveis e impedem garantir último pedido', async () => {
  const { service } = carregarServico({
    respostaHistorico: { dados: [pedido(1)], consultaIncompleta: true, totalOrigem: 42 }
  });
  const r = await service.consultarPedidos({ favorecido: 12, ultimo: true });
  assert.equal(r.total_origem, 42);
  assert.equal(r.resultado_completo, false);
  assert.equal(r.ultimo_pedido_confirmado, false);
  assert.match(r.avisos.join(' '), /histórico incompleto/);
});

test('filtros de número, data e cancelado continuam independentes no histórico completo', async () => {
  const { service } = carregarServico({
    registros: [
      pedido(1, { situacao: 'C' }), pedido(2),
      pedido(3, { data: '2026-11-21' }), pedido(4, { numero: '0099999' })
    ]
  });
  const r = await service.consultarPedidos({
    favorecido: 12, numero: '002', data: '2026-11-22', incluir_cancelados: false
  });
  assert.deepEqual(r.pedidos.map(p => p.id_mestre), [2]);
});

test('detalha itens pelo id inteiro real e mantém valores ausentes como null', async () => {
  const item = pedido(102, { totalPago: null, saldoRestante: undefined, itens: [
    { item: 55, descricao: 'Panela 4,5 L sem caixa', quantidade: 50, preco: 35.9, subtotal: 1795 }
  ] });
  const { service, chamados } = carregarServico({ registros: [item] });
  const r = await service.detalharPedido({ id_mestre: 102 });
  assert.equal(r.pedido.itens[0].quantidade, 50);
  assert.equal(r.pedido.itens[0].preco_unitario, 35.9);
  assert.equal(r.pedido.total_pago, null);
  assert.equal(r.pedido.saldo_restante, null);
  assert.equal(chamados.filter(c => c[0] === 'detalhe').length, 1);
  await assert.rejects(service.detalharPedido({ id_mestre: '0020021' }), /ID real/);
  await assert.rejects(service.detalharPedido({ id_mestre: true }), /ID real/);
});

test('normalizador compartilhado do pedido preserva desconhecido separado de null explícito', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/services/legado/pedido/pedidosLegado.service.js'), 'utf8');
  const m = { exports: {} };
  new Function('require', 'module', 'exports', source + '\nmodule.exports.normalizarParaTeste = normalizarPedido;')(
    () => ({}), m, m.exports
  );
  const normalizar = m.exports.normalizarParaTeste;
  assert.equal(normalizar({}).dataExpedicaoDisponivel, false);
  assert.equal(normalizar({ CAMPO01: null }).dataExpedicaoDisponivel, true);
  assert.equal(normalizar({ CAMPO01: null }).dataExpedicao, null);
  assert.equal(normalizar({ CAMPO01: '22/11/2026' }).dataExpedicao, '22/11/2026');
});

test('histórico usa gateway autenticado e preserva campo de expedição e sinais de corte', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/services/legado/pedidos-cliente/pedidos-cliente.service.js'), 'utf8');
  const chamadas = [];
  const m = { exports: {} };
  const deps = {
    sharp: () => {},
    '../../integracoes/zapi.service': {},
    '../clientes-creditos/clientes-creditos.service': { aplicarBaixasEmPedidos: async pedidos => pedidos },
    '../legadoBridge.service': { get: async (url, params) => {
      chamadas.push([url, params]);
      return { cliente: eloise, hasMore: true, totalRegistros: 400, dados: [
        { SAIDA: 101, NUMERO: '0020021', CAMPO01: null },
        { SAIDA: 102, NUMERO: '0020022' }
      ] };
    } }
  };
  new Function('require', 'module', 'exports', source)(name => deps[name], m, m.exports);
  const r = await m.exports.listarPedidosPorCliente(12);
  assert.deepEqual(chamadas[0], ['/api/pedidos-cliente/12', { incluirCancelados: 1 }]);
  assert.equal(r.dados[0].idMestre, 101);
  assert.equal(r.dados[0].dataExpedicaoDisponivel, true);
  assert.equal(r.dados[1].dataExpedicaoDisponivel, false);
  assert.equal(r.consultaIncompleta, true);
  assert.equal(r.totalOrigem, 400);
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
