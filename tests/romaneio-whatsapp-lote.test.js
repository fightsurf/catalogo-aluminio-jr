'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../views/legado/carradas/carradas-progresso.html'), 'utf8');
const service = fs.readFileSync(path.join(__dirname, '../src/services/legado/carradas-progresso/carradas-progresso.service.js'), 'utf8');

function trecho(antes, depois) {
  const inicio = html.indexOf(antes);
  assert.ok(inicio >= 0, 'Trecho não encontrado: ' + antes);
  const fim = html.indexOf(depois, inicio);
  assert.ok(fim > inicio, 'Fim não encontrado: ' + depois);
  return html.slice(inicio, fim);
}

const script = [
  trecho('    function compararTextoRomaneio(', '    function construirLinhasRomaneioEntrega('),
  trecho('    function agruparDestinatariosRomaneio(', '    function limparResultadoRomaneio(')
].join('\n');

function ambiente(linhas = [], confirmar = true) {
  const chamadas = [];
  const confirmacoes = [];
  const feedback = { mensagem: '', tipo: '' };
  const botoes = {
    btnEnviarRomaneioTransportadoraWhatsapp: { disabled: false },
    btnEnviarRomaneioRedespachoWhatsapp: { disabled: false },
    btnEnviarRomaneioAgenciaWhatsapp: { disabled: false }
  };
  const contexto = {
    estado: { romaneioEnviando: false },
    el: { ...botoes, feedbackRomaneioWhatsapp: feedback },
    window: { confirm: mensagem => { confirmacoes.push(mensagem); return confirmar; } },
    construirLinhasRomaneioEntrega: () => linhas,
    construirTextoRomaneioWhatsapp: (grupoLinhas, tipo, nome) =>
      JSON.stringify({ tipo, nome, pedidos: grupoLinhas.map(p => p.numeroPedido) }),
    setFeedback: (elemento, mensagem, tipo) => {
      elemento.mensagem = mensagem;
      elemento.tipo = tipo || '';
    },
    request: async (url, opcoes) => {
      assert.ok(Object.values(botoes).every(botao => botao.disabled), 'Botões devem ficar bloqueados durante envio');
      chamadas.push({ url, payload: JSON.parse(opcoes.body) });
      return { success: true };
    }
  };
  vm.runInNewContext(script, contexto, { filename: 'romaneio-inline.js' });
  return { contexto, chamadas, confirmacoes, feedback, botoes };
}

function linha(numeroPedido, transportadora, telefoneTransportadora, redespacho = '', telefoneRedespacho = '', agencia = '', telefoneAgencia = '') {
  return {
    numeroPedido, cliente: 'Cliente ' + numeroPedido,
    transportadora, telefoneTransportadora, redespacho, telefoneRedespacho,
    agencia, telefoneAgencia
  };
}

test('os três botões de envio ficam lado a lado com os filtros', () => {
  for (const nome of ['Transportadora', 'Redespacho', 'Agencia']) {
    const filtro = html.indexOf('id="btnFiltrarRomaneio' + nome + '"');
    const envio = html.indexOf('id="btnEnviarRomaneio' + nome + 'Whatsapp"');
    assert.ok(filtro > 0 && envio > filtro && envio - filtro < 450);
  }
});

test('dados de telefone são carregados da transportadora, redespacho e agência', () => {
  for (const campo of [
    'transportadoraTelefonePrincipal: localEntregaRow?.transportadoraTelefonePrincipal',
    'redespachoTransportadoraTelefonePrincipal: localEntregaRow?.redespachoTransportadoraTelefonePrincipal',
    'agenciaRecebimentoTelefone: localEntregaRow?.agenciaRecebimentoTelefone'
  ]) assert.ok(service.includes(campo), 'Campo faltante: ' + campo);
  assert.ok(service.includes('a.telefone AS agencia_recebimento_telefone'));
});

test('agrupa pedidos por cada destinatário, sem misturar transportadora e redespacho', () => {
  const linhas = [
    linha('1', 'Expresso A', '5583990000001', 'Redespacho X', '5583990000003', 'Agência Sul', '5583990000005'),
    linha('2', 'Expresso A', '5583990000001', 'Redespacho Y', '5583990000004', 'Agência Norte', '5583990000006'),
    linha('3', 'Expresso B', '5583990000002', 'Redespacho X', '5583990000003', 'Agência Sul', '5583990000005')
  ];
  const { contexto } = ambiente(linhas);
  const gruposTransportadora = contexto.agruparDestinatariosRomaneio('transportadora', linhas);
  const gruposRedespacho = contexto.agruparDestinatariosRomaneio('redespacho', linhas);
  const gruposAgencia = contexto.agruparDestinatariosRomaneio('agencia', linhas);
  assert.equal(gruposTransportadora.length, 2);
  assert.equal(gruposRedespacho.length, 2);
  assert.equal(gruposAgencia.length, 2);
  assert.equal(gruposTransportadora.find(g => g.nome === 'Expresso A').linhas.length, 2);
  assert.equal(gruposRedespacho.find(g => g.nome === 'Redespacho X').linhas.length, 2);
  assert.equal(gruposAgencia.find(g => g.nome === 'Agência Sul').linhas.length, 2);
});

test('botão da transportadora envia apenas um romaneio por transportadora, após confirmação', async () => {
  const linhas = [
    linha('1', 'Expresso A', '5583990000001'),
    linha('2', 'Expresso A', '5583990000001'),
    linha('3', 'Expresso B', '5583990000002')
  ];
  const ui = ambiente(linhas);
  await ui.contexto.enviarRomaneioWhatsappLote('transportadora');
  assert.equal(ui.confirmacoes.length, 1);
  assert.match(ui.confirmacoes[0], /2 romaneio/);
  assert.equal(ui.chamadas.length, 2);
  assert.ok(ui.chamadas.every(c => c.url === '/api/whatsapp/enviar'));
  const envios = ui.chamadas.map(c => ({ telefone: c.payload.telefone, conteudo: JSON.parse(c.payload.mensagem) }));
  assert.deepEqual(envios.map(e => e.conteudo.pedidos), [['1', '2'], ['3']]);
  assert.deepEqual(envios.map(e => e.telefone), ['5583990000001', '5583990000002']);
  assert.match(ui.feedback.mensagem, /Enviados: 2/);
  assert.ok(Object.values(ui.botoes).every(b => b.disabled === false));
});

test('sem confirmação, não há disparo', async () => {
  const ui = ambiente([linha('1', 'Expresso A', '5583990000001')], false);
  await ui.contexto.enviarRomaneioWhatsappLote('transportadora');
  assert.equal(ui.chamadas.length, 0);
});

test('agências sem telefone ou com telefones divergentes são ignoradas', async () => {
  const ui = ambiente([
    linha('1', 'A', '5583990000001', '', '', 'Agência Um', ''),
    linha('2', 'B', '5583990000002', '', '', 'Agência Dois', '5583990000007'),
    linha('3', 'B', '5583990000002', '', '', 'Agência Dois', '5583990000008'),
    linha('4', 'B', '5583990000002', '', '', 'Agência Três', '5583990000009')
  ]);
  await ui.contexto.enviarRomaneioWhatsappLote('agencia');
  assert.equal(ui.chamadas.length, 1);
  assert.equal(ui.chamadas[0].payload.telefone, '5583990000009');
  assert.match(ui.feedback.mensagem, /Ignorados: 2/);
});

test('script inline da página mantém sintaxe JavaScript válida', () => {
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)];
  assert.ok(scripts.length > 0);
  for (const [i, match] of scripts.entries()) {
    new vm.Script(match[1], { filename: 'carradas-progresso-inline-' + i + '.js' });
  }
});
