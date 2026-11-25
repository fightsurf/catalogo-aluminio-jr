'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const mensagem = require('../public/js/pagamentos-whatsapp-mensagem');

function carregar({ pedidos, detalhes, cliente, incompleto = false, enviarTexto } = {}) {
  const chamadas = { pagamentos: [], enviados: [], controles: [], progresso: [] };
  const dados = pedidos || [
    { numero: '103', saida: 13, empresa: -1, pdv: 0, favorecido: 91, situacao: 'A' },
    { numero: '101', saida: 11, empresa: -1, pdv: 0, favorecido: 91, situacao: 'A' },
    { numero: '104', saida: 14, empresa: -1, pdv: 0, favorecido: 91, situacao: 'C', cancelado: true },
    { numero: '102', saida: 12, empresa: -1, pdv: 0, favorecido: 91, situacao: 'A' }
  ];
  const detalhamento = (item) => ({
    pedido: { numero: item.numero, cliente: { favorecido: 91, nome: 'Júnior Representante', telefone1: '83999999999' } },
    pagamentos: [{ condicao: 'V', dataPgto: '2026-11-24', valor: 400 }],
    resumo: { totalVenda: 1000, totalPago: 400, saldoRestante: 600 }
  });
  const detalhesPorSaida = detalhes || new Map(dados.map(item => [item.saida, detalhamento(item)]));
  const dependencias = {
    './mcpConsultaPedidos.service': {
      resolverCliente: async () => cliente || { encontrado: true,
        cliente: { favorecido: 91, nome: 'Júnior Representante' } }
    },
    '../legado/pedidos-cliente/pedidos-cliente.service': {
      listarPedidosPorCliente: async () => ({
        cliente: { favorecido: 91 }, dados, consultaIncompleta: incompleto
      })
    },
    '../legado/pagamentos/pagamentos.service': {
      buscarPedidoComPagamentos: async filtros => {
        chamadas.pagamentos.push(filtros);
        return detalhesPorSaida.get(filtros.saida);
      }
    },
    '../../../public/js/pagamentos-whatsapp-mensagem': mensagem,
    '../whatsapp/envio-whatsapp.service': {
      normalizarTelefone: t => String(t || '').replace(/\D/g, ''),
      enviarMensagem: async payload => {
        chamadas.enviados.push(payload);
        return enviarTexto ? enviarTexto(payload) : { success: true, zapi: { messageId: 'prova-' + chamadas.enviados.length } };
      }
    },
    '../whatsapp/central-controle.service': {
      verificar: async id => { chamadas.controles.push(id); return true; },
      comFuncionalidade: async (id, fn) => { chamadas.controles.push(id); return fn(); }
    }
  };
  const modulo = { exports: {} };
  const source = fs.readFileSync(path.resolve(__dirname, '../src/services/integracao/mcpPagamentosWhatsapp.service.js'), 'utf8');
  new Function('require', 'module', 'exports', source)(name => {
    if (!(name in dependencias)) throw new Error('Dependência não simulada: ' + name);
    return dependencias[name];
  }, modulo, modulo.exports);
  const registrarProgresso = async etapa => chamadas.progresso.push(etapa);
  return { ...modulo.exports, chamadas, registrarProgresso, detalhesPorSaida };
}

test('o texto compartilhado respeita o botão preto, inclusive baixa para crédito', () => {
  const detalhe = {
    pedido: { numero: '123', cliente: { nome: 'Júnior Representante' } },
    resumo: { totalVenda: 100, totalPago: 30, saldoRestante: 70 },
    pagamentos: [{ condicao: 'V', dataPgto: '2026-11-24', valor: 30 }]
  };
  const texto = mensagem.montarMensagem(detalhe).replace(/\u00a0/g, ' ');
  assert.match(texto, /Número do pedido: \*123\*/);
  assert.match(texto, /24\/11\/2026: \*R\$ 30,00\*/);
  assert.match(texto, /Restante a pagar: \*R\$ 70,00\*/);
  const baixa = mensagem.montarMensagem({ ...detalhe, resumo: {
    ...detalhe.resumo, baixadoParaCredito: true, valorBaixadoParaCredito: 70
  } }).replace(/\u00a0/g, ' ');
  assert.match(baixa, /Baixa para crédito/);
  assert.match(baixa, /Saldo do pedido: \*R\$ 0,00\*/);
});

test('prévia escolhe os últimos 3 por número, ignora cancelado, sem enviar', async () => {
  const a = carregar();
  const previa = await a.prepararEnvio({ cliente: 'Júnior Representante', quantidade: 3 });
  assert.deepEqual(previa.resumo.pedidos.map(p => p.numero), ['103', '102', '101']);
  assert.equal(previa.resumo.cancelados_ignorados, 1);
  assert.equal(previa.resumo.ordenacao, 'numero_do_pedido_decrescente');
  assert.equal(previa.resumo.destinatario.telefone, '5583999999999');
  assert.deepEqual(a.chamadas.pagamentos.map(f => f.saida), [13, 12, 11]);
  assert.deepEqual(a.chamadas.enviados, []);
  assert.deepEqual(a.chamadas.controles, ['pagamentos_mensagens']);
});

test('confirmação revalida e envia três mensagens separadas ao mesmo cliente', async () => {
  const a = carregar();
  const previa = await a.prepararEnvio({ favorecido: 91 });
  const resultado = await a.executarEnvio(previa.payload, { registrarProgresso: a.registrarProgresso });
  assert.equal(resultado.status, 'aceito_pelo_provedor');
  assert.equal(resultado.aceitos, 3);
  assert.equal(resultado.entrega_confirmada, false);
  assert.equal(a.chamadas.enviados.length, 3);
  assert.deepEqual(a.chamadas.enviados.map(m => m.telefone), Array(3).fill('5583999999999'));
  assert.deepEqual(a.chamadas.progresso.map(p => p.status), [
    'em_processamento', 'aceito_pelo_provedor',
    'em_processamento', 'aceito_pelo_provedor',
    'em_processamento', 'aceito_pelo_provedor'
  ]);
});

test('mudança de pagamento após a prévia impede qualquer mensagem', async () => {
  const a = carregar();
  const previa = await a.prepararEnvio({ favorecido: 91 });
  a.detalhesPorSaida.get(13).resumo.saldoRestante = 599;
  await assert.rejects(a.executarEnvio(previa.payload, { registrarProgresso: a.registrarProgresso }), /mudaram desde a prévia/);
  assert.deepEqual(a.chamadas.enviados, []);
  assert.deepEqual(a.chamadas.progresso, []);
});

test('histórico incompleto, homônimos e números duplicados impedem preparação', async () => {
  const incompleto = carregar({ incompleto: true });
  await assert.rejects(incompleto.prepararEnvio({ favorecido: 91 }), /Histórico de pedidos/);
  const ambiguo = carregar({ cliente: { encontrado: true, necessita_escolha_cliente: true } });
  await assert.rejects(ambiguo.prepararEnvio({ cliente: 'Júnior' }), /homônimos/);
  const repetido = carregar({ pedidos: [
    { numero: '103', saida: 13, favorecido: 91, situacao: 'A' },
    { numero: '103', saida: 14, favorecido: 91, situacao: 'A' }
  ] });
  await assert.rejects(repetido.prepararEnvio({ favorecido: 91 }), /duplicados/);
});

test('falha incerta interrompe a sequência sem repetição automática', async () => {
  const a = carregar({ enviarTexto: async () => { throw new Error('timeout'); } });
  const previa = await a.prepararEnvio({ favorecido: 91 });
  const resultado = await a.executarEnvio(previa.payload, { registrarProgresso: a.registrarProgresso });
  assert.equal(resultado.status, 'resultado_incerto');
  assert.equal(resultado.aceitos, 0);
  assert.equal(a.chamadas.enviados.length, 1);
  assert.equal(resultado.resultados[0].status, 'resultado_incerto');
});
