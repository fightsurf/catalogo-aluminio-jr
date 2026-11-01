import { createWidget, widget, prop, align, text_style } from '@zos/ui'
import { LocalStorage } from '@zos/storage'

// AVN Água: miniaplicativo do Amazfit Balance. Nesta versão os registros
// permanecem no relógio, mesmo sem Bluetooth, Wi-Fi ou celular.
const STORAGE_KEY = 'avn_agua_diario_v1'
const storage = new LocalStorage()
const ML_POR_TOQUE = 1000

const BRANCO = 0xffffff
const AZUL_CLARO = 0x94d4ff
const AZUL = 0x218cde
const FUNDO = 0x101c30
const CINZA = 0xa9bed8

function dois(n) {
  return String(n).padStart(2, '0')
}

function diaLocal(agora = new Date()) {
  return [agora.getFullYear(), dois(agora.getMonth() + 1), dois(agora.getDate())].join('-')
}

function mililitros(valor) {
  return String(valor).replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ' mL'
}

function lerDiario() {
  const dados = storage.getItem(STORAGE_KEY, {})
  return dados && typeof dados === 'object' && !Array.isArray(dados) ? dados : {}
}

function lerHoje() {
  const valor = Number(lerDiario()[diaLocal()] || 0)
  return Number.isFinite(valor) && valor >= 0 ? valor : 0
}

function registrarAgua(ml) {
  const diario = lerDiario()
  const dia = diaLocal()
  const atual = Number(diario[dia] || 0)
  if (!Number.isFinite(atual) || atual < 0 || atual > 1000000) {
    throw new Error('Registro local inválido')
  }
  diario[dia] = atual + ml
  storage.setItem(STORAGE_KEY, diario)
  return diario[dia]
}

Page({
  build() {
    createWidget(widget.FILL_RECT, { x: 0, y: 0, w: 480, h: 480, color: FUNDO })

    createWidget(widget.TEXT, {
      x: 115, y: 65, w: 250, h: 48, text: 'AVN  ÁGUA',
      color: AZUL_CLARO, text_size: 33, align_h: align.CENTER_H,
      align_v: align.CENTER_V, text_style: text_style.NONE
    })
    createWidget(widget.TEXT, {
      x: 55, y: 140, w: 370, h: 40, text: 'Água ingerida hoje',
      color: CINZA, text_size: 25, align_h: align.CENTER_H
    })
    const valor = createWidget(widget.TEXT, {
      x: 20, y: 187, w: 440, h: 78,
      text: mililitros(lerHoje()), color: BRANCO, text_size: 54,
      align_h: align.CENTER_H, align_v: align.CENTER_V
    })
    const status = createWidget(widget.TEXT, {
      x: 58, y: 392, w: 364, h: 40,
      text: 'Salvo somente no relógio', color: CINZA, text_size: 19,
      align_h: align.CENTER_H, align_v: align.CENTER_V
    })

    createWidget(widget.BUTTON, {
      x: 68, y: 291, w: 344, h: 84,
      text: '+ 1.000 mL', text_size: 37, color: BRANCO,
      normal_color: AZUL, press_color: 0x14649e, radius: 22,
      click_func: () => {
        try {
          const total = registrarAgua(ML_POR_TOQUE)
          valor.setProperty(prop.TEXT, mililitros(total))
          status.setProperty(prop.TEXT, 'Registrado no relógio')
        } catch (erro) {
          status.setProperty(prop.TEXT, 'Falha ao salvar: tente novamente')
          console.error('[AVN Água] Falha local:', erro)
        }
      }
    })
  }
})
