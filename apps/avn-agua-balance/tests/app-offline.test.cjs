'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')

const source = fs.readFileSync(path.join(__dirname, '..', 'pages', 'index.js'), 'utf8')

function iniciar(opcoes = {}) {
  const dados = opcoes.persistido || new Map()
  const widgets = []
  let page
  const hoje = opcoes.hoje || '2026-10-31T15:00:00'
  class DataFalsa extends Date {
    constructor(...args) { super(...(args.length ? args : [hoje])) }
  }
  class StorageFalso {
    getItem(k, padrao) { return dados.has(k) ? dados.get(k) : padrao }
    setItem(k, v) { dados.set(k, JSON.parse(JSON.stringify(v))) }
  }
  const ui = {
    widget: { FILL_RECT: 'FILL_RECT', TEXT: 'TEXT', BUTTON: 'BUTTON' },
    prop: { TEXT: 'TEXT' },
    align: { CENTER_H: 1, CENTER_V: 1 },
    text_style: { NONE: 0 },
    createWidget(type, opcoesWidget) {
      const elemento = {
        type, ...opcoesWidget,
        setProperty(chave, valor) { if (chave === 'TEXT') this.text = valor }
      }
      widgets.push(elemento)
      return elemento
    }
  }
  const codigo = source.replace(/^import .*\\n/gm, '')
  const contexto = { ...ui, LocalStorage: StorageFalso, Date: DataFalsa, Page: p => { page = p }, console }
  vm.runInNewContext(codigo, contexto, { filename: 'pages/index.js' })
  page.build()
  return {
    dados,
    botao: widgets.find(w => w.type === 'BUTTON' && w.text.includes('1.000')),
    total: widgets.find(w => w.type === 'TEXT' && w.text.endsWith('mL'))
  }
}

test('um toque registra 1000 mL localmente', () => {
  const app = iniciar()
  app.botao.click_func()
  assert.equal(app.total.text, '1.000 mL')
  assert.equal(app.dados.get('avn_agua_diario_v1')['2026-10-31'], 1000)
})

test('dois toques acumulam 2000 mL sem rede', () => {
  const app = iniciar()
  app.botao.click_func()
  app.botao.click_func()
  assert.equal(app.total.text, '2.000 mL')
  assert.doesNotMatch(source, /\bfetch\s*\(|\bXMLHttpRequest\b|https?:\/\//)
})

test('registrado continua depois de reabrir', () => {
  const app = iniciar()
  app.botao.click_func()
  const reaberto = iniciar({persistido:app.dados})
  assert.equal(reaberto.total.text, '1.000 mL')
})

test('virada do dia preserva o registro anterior e reinicia contador', () => {
  const app = iniciar()
  app.botao.click_func()
  const novoDia = iniciar({persistido:app.dados, hoje:'2026-11-01T12:00:00'})
  assert.equal(novoDia.total.text, '0 mL')
  novoDia.botao.click_func()
  assert.equal(novoDia.total.text, '1.000 mL')
  assert.equal(novoDia.dados.get('avn_agua_diario_v1')['2026-10-31'], 1000)
  assert.equal(novoDia.dados.get('avn_agua_diario_v1')['2026-11-01'], 1000)
})
