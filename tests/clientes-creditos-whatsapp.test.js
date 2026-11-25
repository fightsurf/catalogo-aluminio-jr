'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function criarCenario() {
  const estado = {
    cliente: { favorecido: 123, nome: 'Cliente de teste', telefone1: '(83) 99999-8888' },
    extrato: {
      favorecido: 123,
      clienteNome: 'Cliente de teste',
      resumo: { saldo: 240 },
      lancamentos: [
        { id: 6, data_lancamento: '2026-11-25', valor_debito: 20, valor_credito: 0, descricao: 'Compra balcão' },
        { id: 5, data_lancamento: '2026-11-24', valor_debito: 0, valor_credito: 40, descricao: 'Pagamento PIX' },
        { id: 4, data_lancamento: '2026-11-22', valor_debito: 80, valor_credito: 0, descricao: 'Pedido 100' },
        { id: 3, data_lancamento: '2026-11-20', valor_debito: 0, valor_credito: 10, descricao: 'Pagamento' },
        { id: 2, data_lancamento: '2026-11-19', valor_debito: 150, valor_credito: 0, descricao: 'Venda antiga' },
        { id: 1, data_lancamento: '2026-11-18', valor_debito: 40, valor_credito: 0, descricao: 'Não incluir no resumo' }
      ]
    },
    envios: [], categorias: []
  };
  const arquivo = fs.readFileSync(path.resolve(__dirname, '../src/services/legado/clientes-creditos/clientes-creditos-whatsapp.service.js'), 'utf8');
  const modulo = { exports: {} };
  new Function('require', 'module', 'exports', arquivo)(nome => {
    if (nome === 'node:crypto') return require('node:crypto');
    if (nome === '../clientes/clientes.service') return { buscarCliente: async () => estado.cliente };
    if (nome === './clientes-creditos.service') return { buscarExtrato: async () => estado.extrato };
    if (nome === '../../whatsapp/envio-whatsapp.service') return {
      normalizarTelefone: valor => String(valor || '').replace(/\D/g, ''),
      enviarMensagem: async payload => {
        estado.envios.push(payload);
        return { telefone: payload.telefone };
      }
    };
    if (nome === '../../whatsapp/central-controle.service') return {
      comFuncionalidade: async (id, executar) => {
        estado.categorias.push(id);
        return executar();
      }
    };
    throw new Error('Dependência inesperada: ' + nome);
  }, modulo, modulo.exports);
  return { service: modulo.exports, estado };
}

test('prévia tem data, cliente, cinco últimas movimentações e saldo completo', async () => {
  const { service, estado } = criarCenario();
  const previa = await service.preparar(123);
  const linhas = previa.mensagem.split('\n');
  assert.match(linhas[0], /^\*\d{2}\/\d{2}\/\d{4}\*$/);
  assert.equal(linhas[1], 'Cliente: *Cliente de teste*');
  assert.match(previa.mensagem, /\*Últimas movimentações financeiras \(até 5\):\*/);
  assert.match(previa.mensagem, /1\. 25\/11\/2026 - \*\+ R\$ 20,00\* - Compra balcão/);
  assert.match(previa.mensagem, /2\. 24\/11\/2026 - \*− R\$ 40,00\* - Pagamento PIX/);
  assert.match(previa.mensagem, /5\. 19\/11\/2026/);
  assert.doesNotMatch(previa.mensagem, /Não incluir no resumo/);
  assert.match(previa.mensagem, /Total da dívida: \*R\$ 240,00\*$/);
  assert.equal(previa.telefone, '5583999998888');
  assert.equal(previa.quantidadeMovimentacoes, 5);
  assert.equal(estado.envios.length, 0);
});

test('envia só após confirmação e usa o WhatsApp já existente', async () => {
  const { service, estado } = criarCenario();
  const previa = await service.preparar(123);
  const resultado = await service.enviar(123, previa.confirmacao);
  assert.equal(resultado.solicitado, true);
  assert.equal(estado.envios.length, 1);
  assert.deepEqual(estado.envios[0], { telefone: previa.telefone, mensagem: previa.mensagem });
  assert.deepEqual(estado.categorias, ['pedidos_historico_financeiro']);
});

test('impede envio quando saldo ou telefone muda depois da prévia', async () => {
  const { service, estado } = criarCenario();
  const previa = await service.preparar(123);
  estado.extrato.resumo.saldo = 310;
  await assert.rejects(service.enviar(123, previa.confirmacao), /O extrato ou o telefone mudou/);
  estado.extrato.resumo.saldo = 240;
  estado.cliente.telefone1 = '83888887777';
  await assert.rejects(service.enviar(123, previa.confirmacao), /O extrato ou o telefone mudou/);
  assert.equal(estado.envios.length, 0);
});

test('recusa telefone inválido e cliente de outro código', async () => {
  const { service, estado } = criarCenario();
  estado.cliente.telefone1 = '123';
  await assert.rejects(service.preparar(123), /telefone válido/);
  estado.cliente.telefone1 = '83999998888';
  estado.cliente.favorecido = 321;
  await assert.rejects(service.preparar(123), /não correspondem ao mesmo cliente/);
});

test('saldo negativo apresenta crédito, não dívida negativa', () => {
  const { service } = criarCenario();
  const mensagem = service.formatarMensagem({
    nome: 'Cliente com crédito', dataEnvio: '25/11/2026', lancamentos: [], saldo: -10
  });
  assert.match(mensagem, /Crédito do cliente: \*R\$ 10,00\*$/);
});

test('HTML apresenta botão ao lado de registrar dívida e modal de confirmação', () => {
  const html = fs.readFileSync(path.resolve(__dirname, '../views/legado/clientes-creditos/clientes-creditos-extrato.html'), 'utf8');
  assert.match(html, /id="btnRegistrarDivida"[^>]+>Registrar dívida<\/button>\s*<button id="btnWhatsappExtrato" class="btn-whatsapp"/);
  assert.match(html, /id="modalWhatsappExtrato"/);
  assert.match(html, /id="btnConfirmarWhatsappExtrato"/);
  const script = html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(script);
  assert.doesNotThrow(() => new vm.Script(script[1]));
});

test('rotas de prévia e envio têm autorização administrativa', () => {
  const rotas = fs.readFileSync(path.resolve(__dirname, '../src/routes/legado/clientes-creditos/clientes-creditos.routes.js'), 'utf8');
  assert.match(rotas, /router\.get\('\/:favorecido\/extrato\/whatsapp\/previa', requireAuth/);
  assert.match(rotas, /router\.post\('\/:favorecido\/extrato\/whatsapp', requireAuth/);
});
