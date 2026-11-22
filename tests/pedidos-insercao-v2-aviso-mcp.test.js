'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function ambiente({ vinculado = true, telefone = '84999999999', falhaWhatsApp = false, centralBloqueada = false } = {}) {
  const source = fs.readFileSync(
    path.join(__dirname, '../src/services/legado/pedidos-insercao-v2/pedidos-insercao-v2.service.js'), 'utf8'
  );
  const mensagens = [];
  const chamadasBridge = [];
  const dependencias = {
    '../../produto/produto.service': {
      buscar: async () => ({ item_legado: 10, nome: 'Panela de pressão 4,5 L' })
    },
    '../clientes/clientes.service': {
      buscarCliente: async () => ({ nome: 'Cliente de Teste', telefonePrincipal: telefone })
    },
    '../../whatsapp/envio-whatsapp.service': {
      enviarMensagem: async payload => {
        mensagens.push(payload);
        if (falhaWhatsApp) throw new Error(typeof falhaWhatsApp === 'string' ? falhaWhatsApp : 'Falha simulada de WhatsApp');
        return { success: true };
      }
    },
    '../../whatsapp/central-controle.service': {
      comFuncionalidade: (id, fn) => {
        assert.equal(id, 'pedidos_texto');
        if (centralBloqueada) {
          const erro = new Error('WhatsApp desligado na Central');
          erro.codigo = 'WHATSAPP_ENVIO_DESATIVADO';
          throw erro;
        }
        return fn();
      }
    }
  };
  const fetch = async (url, options) => {
    chamadasBridge.push({ url, payload: JSON.parse(options.body) });
    return { ok: true, json: async () => ({
      pedido: { numero: '000123' },
      carradaVinculada: {
        sucesso: vinculado, codigo: 1697, data: '2026-12-02', descricao: 'Entrega de quarta'
      }
    }) };
  };
  const modulo = { exports: {} };
  new Function('require', 'fetch', 'process', 'module', 'exports', source)(
    nome => {
      assert.ok(dependencias[nome], 'Dependência inesperada: ' + nome);
      return dependencias[nome];
    },
    fetch,
    { env: { LEGADO_BRIDGE_URL: 'http://bridge-de-teste' } },
    modulo,
    modulo.exports
  );
  async function inserir(aviso = true) {
    return modulo.exports.inserirPedido({
      favorecido: 123, vendedor: 9, carrada_codigo: 1697,
      aviso_whatsapp_carrada: aviso,
      itens: [{ produto_id: 1, quantidade: 50, preco: 35.90 }]
    });
  }
  return { inserir, mensagens, chamadasBridge };
}

test('entrada em carrada envia o mesmo aviso automático da Inserção V2', async () => {
  const t = ambiente();
  const r = await t.inserir();
  assert.equal(r.avisoWhatsappCarrada.status, 'aceito_pelo_provedor');
  assert.equal(t.mensagens.length, 1);
  assert.equal(t.chamadasBridge.length, 1);
  assert.match(t.mensagens[0].mensagem, /Pedido: 000123/);
  assert.ok(t.mensagens[0].mensagem.includes('02/12/2026'));
  assert.equal(t.mensagens[0].telefone, '84999999999');
  assert.equal(t.chamadasBridge[0].payload.aviso_whatsapp_carrada, undefined);
});

test('não envia quando não autorizado pela tela/MCP', async () => {
  const t = ambiente();
  const r = await t.inserir(false);
  assert.equal(t.mensagens.length, 0);
  assert.equal(r.avisoWhatsappCarrada, undefined);
});

test('não envia sem vínculo confirmado nem sem telefone', async () => {
  for (const configuracao of [{ vinculado: false }, { telefone: '' }]) {
    const t = ambiente(configuracao);
    const r = await t.inserir();
    assert.equal(t.mensagens.length, 0);
    assert.equal(r.avisoWhatsappCarrada.status, 'nao_enviado');
  }
});

test('falha de WhatsApp não desfaz o pedido nem repete a gravação', async () => {
  const t = ambiente({ falhaWhatsApp: true });
  const r = await t.inserir();
  assert.equal(r.pedido.numero, '000123');
  assert.equal(r.avisoWhatsappCarrada.status, 'resultado_incerto');
  assert.equal(t.chamadasBridge.length, 1);
  assert.equal(t.mensagens.length, 1);
});

test('central desligada mantém o pedido gravado e informa aviso não enviado sem replay', async () => {
  const t = ambiente({ centralBloqueada: true });
  const r = await t.inserir();
  assert.equal(r.pedido.numero, '000123');
  assert.equal(r.avisoWhatsappCarrada.status, 'nao_enviado');
  assert.equal(r.avisoWhatsappCarrada.motivo, 'envio_bloqueado_central');
  assert.equal(t.mensagens.length, 0);
  assert.equal(t.chamadasBridge.length, 1);
});

test('erro de transporte no aviso não expõe URL nem credenciais do provedor', async () => {
  const t = ambiente({ falhaWhatsApp: 'Falha em https://provedor.invalid/instances/conta/token/SEGREDO/send-text' });
  const r = await t.inserir();
  assert.equal(r.avisoWhatsappCarrada.status, 'resultado_incerto');
  assert.equal(r.avisoWhatsappCarrada.motivo, 'falha_ou_resultado_incerto_no_aviso_whatsapp');
  assert.ok(!JSON.stringify(r).includes('SEGREDO'));
  assert.ok(!JSON.stringify(r).includes('provedor.invalid'));
});
