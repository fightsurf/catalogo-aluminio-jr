'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const script = fs.readFileSync(path.join(__dirname, '../public/js/pedido-resumo-ia.js'), 'utf8');

function simularModal() {
  const elementos = new Map();
  const pendentes = [];
  class Elemento {
    constructor() {
      this.disabled = false;
      this.hidden = false;
      this.value = '';
      this.textContent = '';
      this.style = {};
      this.listeners = {};
    }
    addEventListener(evento, fn) { this.listeners[evento] = fn; }
    emitir(evento) {
      assert.equal(typeof this.listeners[evento], 'function', 'Evento sem listener: ' + evento);
      return this.listeners[evento]({ target: this });
    }
    setAttribute() {}
    removeAttribute(atributo) { if (atributo === 'src') delete this.src; }
    pause() {}
    focus() {}
  }
  const el = id => {
    if (!elementos.has(id)) elementos.set(id, new Elemento());
    return elementos.get(id);
  };
  const document = {
    head: { appendChild() {} },
    body: { appendChild() {} },
    createElement: () => new Elemento(),
    getElementById: el,
    addEventListener() {}
  };
  const respostaJson = data => ({ ok: true, json: async () => data });
  const fetch = async (url, options = {}) => {
    if (url === '/api/legado/pedidos/resumo-ia/config-voz') {
      return respostaJson({ success: true, data: { voz: 'voz_valida_12345', modelo: 'eleven_multilingual_v2' } });
    }
    if (/\/resumo-ia$/.test(url) && options.method === 'POST') {
      return respostaJson({ success: true, data: {
        texto: 'Apresentação gerada para o cliente.', pedidoNumero: '123', tipo: 'orcamento'
      } });
    }
    if (url === '/api/whatsapp/elevenlabs-jr/gerar') {
      return await new Promise(resolve => pendentes.push(resolve));
    }
    throw new Error('Endpoint não simulado: ' + url);
  };
  const window = { alert() {}, confirm: () => false };
  const URL = { createObjectURL: () => 'blob:preview-teste', revokeObjectURL() {} };
  vm.runInNewContext(script, { window, document, fetch, URL }, { filename: 'pedido-resumo-ia.js' });
  return { window, el, pendentes };
}
const proximoTurno = () => new Promise(resolve => setImmediate(resolve));
const respostaAudio = () => ({
  ok: true,
  headers: { get: nome => nome === 'X-Preview-Id' ? 'previa-teste' : null },
  blob: async () => ({ type: 'audio/mpeg' })
});

test('o botão é reabilitado após alterar o texto durante geração pendente', async () => {
  const ui = simularModal();
  ui.window.PedidoResumoIA.abrir({ idMestre: 123 });
  await proximoTurno();

  const botao = ui.el('resumoIaAudio');
  assert.equal(botao.disabled, false);
  const geracao = botao.emitir('click');
  await proximoTurno();
  assert.equal(botao.disabled, true);
  assert.equal(ui.pendentes.length, 1);

  ui.el('resumoIaTexto').value = 'Novo texto';
  ui.el('resumoIaTexto').emitir('input');
  assert.equal(botao.disabled, false);
  ui.pendentes.shift()(respostaAudio());
  await geracao;
  assert.equal(botao.disabled, false);
  assert.equal(ui.el('resumoIaPlayer').hidden, true);
  assert.equal(ui.el('resumoIaEnviar').disabled, true);
});

test('ao fechar e reabrir, uma geração antiga não bloqueia o botão', async () => {
  const ui = simularModal();
  ui.window.PedidoResumoIA.abrir({ idMestre: 123 });
  await proximoTurno();

  const botao = ui.el('resumoIaAudio');
  const geracaoAntiga = botao.emitir('click');
  await proximoTurno();
  assert.equal(botao.disabled, true);
  ui.el('resumoIaFechar').emitir('click');
  assert.equal(botao.disabled, false);

  ui.window.PedidoResumoIA.abrir({ idMestre: 124 });
  await proximoTurno();
  ui.pendentes.shift()(respostaAudio());
  await geracaoAntiga;
  assert.equal(botao.disabled, false);
  assert.equal(ui.el('resumoIaPlayer').hidden, true);
});

test('geração bem-sucedida reabilita gerar áudio e libera envio da prévia', async () => {
  const ui = simularModal();
  ui.window.PedidoResumoIA.abrir({ idMestre: 123 });
  await proximoTurno();

  const botao = ui.el('resumoIaAudio');
  const geracao = botao.emitir('click');
  await proximoTurno();
  assert.equal(botao.disabled, true);
  ui.pendentes.shift()(respostaAudio());
  await geracao;
  assert.equal(botao.disabled, false);
  assert.equal(ui.el('resumoIaPlayer').hidden, false);
  assert.equal(ui.el('resumoIaEnviar').disabled, false);
});
