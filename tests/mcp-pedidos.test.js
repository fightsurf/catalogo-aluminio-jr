'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function criarAmbiente(opcoes = {}) {
  const source = fs.readFileSync(
    path.join(__dirname, '../src/services/integracao/mcpPedidos.service.js'), 'utf8'
  );
  const drafts = new Map();
  let gravacoes = 0;
  let envios = 0;
  const payloads = [];
  let precoAtual = 25;
  const produto = () => ({
    id: 10, nome: 'Panela 3 litros', preco: precoAtual, item_legado: 99,
    ativo: true, perfil_orcamento: true, perfil_kit_feirinha: false
  });
  const pool = {
    async query(sql, params = []) {
      if (sql.includes('CREATE TABLE IF NOT EXISTS')) return { rows: [] };
      if (sql.includes('INSERT INTO mcp_pedidos_rascunhos')) {
        drafts.set(params[0], {
          id: params[0], codigo_hash: params[1],
          payload: JSON.parse(params[2]), resumo: JSON.parse(params[3]),
          status: 'aguardando_confirmacao', expira_em: new Date(Date.now() + 900000)
        });
        return { rows: [] };
      }
      if (sql.includes('SET status = \'em_processamento\'')) {
        const d = drafts.get(params[0]);
        if (!d || d.codigo_hash !== params[1] || d.status !== 'aguardando_confirmacao') return { rows: [] };
        if (sql.includes('expira_em > NOW()') && new Date(d.expira_em).getTime() <= Date.now()) return { rows: [] };
        d.status = 'em_processamento';
        return { rows: [{ payload: d.payload }] };
      }
      if (sql.includes('SELECT id, status, resumo')) {
        const d = drafts.get(params[0]);
        return { rows: d ? [d] : [] };
      }
      if (sql.includes("SET status='confirmado'")) {
        const d = drafts.get(params[0]);
        d.status = 'confirmado';
        d.pedido_resultado = JSON.parse(params[1]);
        d.confirmado_em = new Date();
        return { rows: [] };
      }
      if (sql.includes("status='revisao_necessaria'")) {
        const d = drafts.get(params[0]);
        d.status = 'revisao_necessaria';
        d.erro = sql.includes('erro=$2') ? params[1] : /erro='([^']+)'/.exec(sql)?.[1];
        return { rows: [] };
      }
      throw new Error('SQL inesperado: ' + sql.slice(0, 60));
    }
  };
  const clientes = {
    listarClientes: async () => [{ favorecido: 7, nome: 'Cliente JR', cidade: 'Patos', uf: 'PB' }],
    buscarCliente: async id => id === 7 ? { favorecido: 7, nome: 'Cliente JR' } : null
  };
  const vendedores = { buscarVendedor: async id => id === 9 ? { favorecido: 9, nome: 'Vendedor JR' } : null, listarVendedores: async () => [{ favorecido: 9, nome: 'Vendedor JR' }] };
  const produtos = { listar: async () => [produto()], buscar: async id => id === 10 ? produto() : null };
  const pedidos = { inserirPedido: async payload => {
    gravacoes++;
    payloads.push(JSON.parse(JSON.stringify(payload)));
    // O contrato da Inserção V2 só envia quando esta flag é explicitamente true.
    if (payload.aviso_whatsapp_carrada === true) envios++;
    if (opcoes.erroGravacao) throw new Error(opcoes.erroGravacao);
    return opcoes.resultado || {
      pedido: { numero: '12345', saida: 270707, total: payload.total },
      ...(payload.carrada_codigo ? { carradaVinculada: {
        sucesso: true, codigo: payload.carrada_codigo, data: '2026-12-02', descricao: 'QUARTA-FEIRA'
      } } : {})
    };
  } };
  const fakeRequire = name => {
    if (name === 'crypto') return crypto;
    if (name === '../../../db/connection') return pool;
    if (name.endsWith('clientes.service')) return clientes;
    if (name.endsWith('vendedores.service')) return vendedores;
    if (name.endsWith('produto.service')) return produtos;
    if (name.endsWith('pedidos-insercao-v2.service')) return pedidos;
    throw new Error('Dependência inesperada: ' + name);
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', source)(fakeRequire, module, module.exports);
  return {
    service: module.exports,
    getGravacoes: () => gravacoes,
    getEnvios: () => envios,
    getPayloads: () => payloads,
    getRascunho: id => drafts.get(id),
    alterarPreco: novo => { precoAtual = novo; }
  };
}

function dadosBase() {
  return {
    favorecido: 7, vendedor: 9, itens: [{ produto_id: 10, quantidade: 2 }]
  };
}
function confirmacao(draft) {
  return { rascunho_id: draft.rascunho_id, codigo_confirmacao: draft.codigo_confirmacao, confirmacao: 'CONFIRMO' };
}

test('consulta e preparação não gravam pedido no Firebird', async () => {
  const t = criarAmbiente();
  const clientes = await t.service.buscarClientes({ nome: 'cliente' });
  assert.equal(clientes.clientes[0].favorecido, 7);
  const preparado = await t.service.prepararPedido(dadosBase());
  assert.equal(preparado.status, 'aguardando_confirmacao');
  assert.equal(preparado.resumo.total, 50);
  assert.equal(preparado.resumo.versao_fluxo, 2);
  assert.equal(preparado.resumo.aviso_whatsapp_carrada, false);
  assert.equal(t.getGravacoes(), 0);
});

test('exige confirmação, grava uma vez e protege contra repetição', async () => {
  const t = criarAmbiente();
  const draft = await t.service.prepararPedido(dadosBase());
  await assert.rejects(() => t.service.confirmarPedido({
    rascunho_id: draft.rascunho_id,
    codigo_confirmacao: draft.codigo_confirmacao,
    confirmacao: 'SIM'
  }), /CONFIRMO/);
  const data = {
    rascunho_id: draft.rascunho_id,
    codigo_confirmacao: draft.codigo_confirmacao,
    confirmacao: 'CONFIRMO'
  };
  const result = await t.service.confirmarPedido(data);
  assert.equal(result.status, 'confirmado');
  assert.equal(result.numero_pedido, '12345');
  assert.equal(result.proximo_passo, null);
  const duplicate = await t.service.confirmarPedido(data);
  assert.equal(duplicate.status, 'confirmado');
  assert.equal(t.getGravacoes(), 1);
});

test('prévia aceita preço negociado por pedido sem alterar a referência do cadastro', async () => {
  const t = criarAmbiente();
  const preparado = await t.service.prepararPedido({
    ...dadosBase(), itens: [{ produto_id: 10, quantidade: 2, preco: 20 }]
  });
  assert.equal(preparado.resumo.itens[0].preco, 20);
  assert.equal(preparado.resumo.itens[0].preco_referencia, 25);
  assert.equal(preparado.resumo.total, 40);
  const produtos = await t.service.buscarProdutos({ nome: 'Panela' });
  assert.equal(produtos.produtos[0].preco_referencia, 25);
  assert.equal(t.getGravacoes(), 0);
  const confirmado = await t.service.confirmarPedido(confirmacao(preparado));
  assert.equal(confirmado.status, 'confirmado');
  assert.equal(t.getPayloads()[0].total, 40);
  assert.equal(t.getPayloads()[0].itens[0].preco, 20);
  assert.equal(t.getEnvios(), 0);
});

test('confirmação com carrada grava uma vez e deixa o aviso para uma ação separada', async () => {
  const t = criarAmbiente();
  const draft = await t.service.prepararPedido({ ...dadosBase(), carrada_codigo: 1697 });
  assert.equal(draft.resumo.aviso_whatsapp_carrada, false);
  assert.equal(draft.resumo.aviso_whatsapp_separado, true);
  const r = await t.service.confirmarPedido(confirmacao(draft));
  assert.equal(r.status, 'confirmado');
  assert.equal(r.pedido_gravado, true);
  assert.equal(r.id_mestre, 270707);
  assert.deepEqual(r.aviso_whatsapp_carrada, { status: 'nao_enviado', motivo: 'acao_separada' });
  assert.equal(r.proximo_passo.ferramenta, 'preparar_whatsapp_pedido');
  assert.deepEqual(r.proximo_passo.argumentos, { id_mestre: 270707, tipo: 'aviso_carrada' });
  assert.equal(t.getPayloads()[0].carrada_codigo, 1697);
  assert.equal(t.getPayloads()[0].aviso_whatsapp_carrada, false);
  await t.service.confirmarPedido(confirmacao(draft));
  assert.equal(t.getGravacoes(), 1);
  assert.equal(t.getEnvios(), 0);
});

test('rascunho expirado não é consumido e não grava nem envia', async () => {
  const t = criarAmbiente();
  const draft = await t.service.prepararPedido({ ...dadosBase(), carrada_codigo: 1697 });
  t.getRascunho(draft.rascunho_id).expira_em = new Date(Date.now() - 1000);
  const r = await t.service.confirmarPedido(confirmacao(draft));
  assert.equal(r.expirado, true);
  assert.equal(t.getRascunho(draft.rascunho_id).status, 'aguardando_confirmacao');
  assert.equal(t.getGravacoes(), 0);
  assert.equal(t.getEnvios(), 0);
});

test('rascunho antigo ou com envio automático ativo exige nova prévia sem gravar nem enviar', async () => {
  for (const [versao, aviso] of [[undefined, true], [undefined, false], [1, false], [2, true], [2, undefined]]) {
    const t = criarAmbiente();
    const draft = await t.service.prepararPedido({ ...dadosBase(), carrada_codigo: 1697 });
    const payload = t.getRascunho(draft.rascunho_id).payload;
    payload.aviso_whatsapp_carrada = aviso;
    payload.versao_fluxo = versao;
    const r = await t.service.confirmarPedido(confirmacao(draft));
    assert.equal(r.status, 'revisao_necessaria');
    assert.equal(r.pedido_gravado, false);
    assert.match(r.mensagem, /versão anterior/);
    const consulta = await t.service.consultarRascunho({ rascunho_id: draft.rascunho_id });
    assert.equal(consulta.erro, r.mensagem);
    await t.service.confirmarPedido(confirmacao(draft));
    assert.equal(t.getGravacoes(), 0);
    assert.equal(t.getEnvios(), 0);
  }
});

test('erro após tentativa de gravação mantém revisão e nunca repete nem expõe a exceção', async () => {
  const t = criarAmbiente({ erroGravacao: 'Timeout https://bridge.invalid/token/SEGREDO' });
  const draft = await t.service.prepararPedido({ ...dadosBase(), carrada_codigo: 1697 });
  const r = await t.service.confirmarPedido(confirmacao(draft));
  assert.equal(r.status, 'revisao_necessaria');
  const novamente = await t.service.confirmarPedido(confirmacao(draft));
  assert.equal(novamente.status, 'revisao_necessaria');
  assert.match(novamente.erro, /resultado incerto/);
  assert.ok(!JSON.stringify([r, novamente]).includes('SEGREDO'));
  assert.equal(t.getGravacoes(), 1);
  assert.equal(t.getEnvios(), 0);
});

test('aviso só é oferecido após vínculo confirmado da carrada', async () => {
  for (const carradaVinculada of [undefined, { sucesso: false, codigo: 1697 }]) {
    const t = criarAmbiente({ resultado: { pedido: { numero: '12345', saida: 270707 }, carradaVinculada } });
    const draft = await t.service.prepararPedido({ ...dadosBase(), carrada_codigo: 1697 });
    const r = await t.service.confirmarPedido(confirmacao(draft));
    assert.equal(r.status, 'confirmado');
    assert.equal(r.proximo_passo, null);
    assert.equal(r.aviso_whatsapp_carrada.motivo, 'carrada_nao_vinculada');
    assert.equal(t.getGravacoes(), 1);
    assert.equal(t.getEnvios(), 0);
  }
});

test('id interno ausente ou inválido orienta consulta sem inventar identificador do pedido', async () => {
  for (const saida of [undefined, null, false, 'invalido', 0, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    const t = criarAmbiente({ resultado: { pedido: { numero: '12345', saida }, carradaVinculada: { sucesso: true, codigo: 1697 } } });
    const draft = await t.service.prepararPedido({ ...dadosBase(), carrada_codigo: 1697 });
    const r = await t.service.confirmarPedido(confirmacao(draft));
    assert.equal(r.status, 'confirmado');
    assert.equal(r.id_mestre, undefined);
    assert.equal(r.proximo_passo.ferramenta, 'consultar_pedidos');
    assert.deepEqual(r.proximo_passo.argumentos, { numero: '12345' });
  }
});

test('consulta do rascunho não devolve erro bruto armazenado', async () => {
  const t = criarAmbiente();
  const draft = await t.service.prepararPedido(dadosBase());
  t.getRascunho(draft.rascunho_id).erro = 'Credencial interna SEGREDO';
  const consulta = await t.service.consultarRascunho({ rascunho_id: draft.rascunho_id });
  assert.match(consulta.erro, /Falha registrada/);
  assert.ok(!JSON.stringify(consulta).includes('SEGREDO'));
});

test('preço alterado depois da prévia impede gravação', async () => {
  const t = criarAmbiente();
  const draft = await t.service.prepararPedido(dadosBase());
  t.alterarPreco(30);
  const result = await t.service.confirmarPedido({
    rascunho_id: draft.rascunho_id,
    codigo_confirmacao: draft.codigo_confirmacao,
    confirmacao: 'CONFIRMO'
  });
  assert.equal(result.status, 'revisao_necessaria');
  assert.equal(t.getGravacoes(), 0);
});


test('consulta de vendedores para pedido por voz não grava no legado', async () => {
  const t = criarAmbiente();
  const r = await t.service.buscarVendedores({ nome: 'Vendedor' });
  assert.equal(r.vendedores[0].favorecido, 9);
  assert.equal(t.getGravacoes(), 0);
});

test('confirmação é escrita aditiva com escopo OAuth e confirmação obrigatória', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../src/routes/integracao/mcpPedidosTools.js'), 'utf8'
  );
  const confirmar = source.split("name: 'confirmar_pedido'")[1]?.split("name: 'consultar_rascunho'")[0] || '';
  assert.match(source, /const gravacao = \[\{ type: 'oauth2', scopes: \['clientes:read', 'pedidos:write'\] \}\]/);
  assert.match(confirmar, /securitySchemes: gravacao/);
  assert.match(confirmar, /annotations:\s*\{ readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false/);
  assert.match(confirmar, /confirmacao: \{ type: 'string', enum: \['CONFIRMO'\] \}/);
});

