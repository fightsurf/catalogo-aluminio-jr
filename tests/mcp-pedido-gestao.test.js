'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function pedidoBase() {
  return {
    idMestre: 102, numero: '0020021', data: '2026-11-22', situacao: 'A',
    cliente: { favorecido: 12, nome: 'Cliente de teste' },
    vendedor: { favorecido: 5, nome: 'Vendedor de teste' },
    obs: 'Observação inicial', total: 20, totalPago: 0,
    dataExpedicao: null, dataCancelamento: null,
    carradaAtual: { codigo: 1697, data: '2026-12-02', descricao: 'Carrada de teste' },
    itens: [{ item: 50, descricao: 'Produto original', quantidade: 2, preco: 10, subtotal: 20 }]
  };
}
function carregarServico(opcoes = {}) {
  const estado = {
    pedido: pedidoBase(), produtos: { 7: { id: 7, item_legado: 70, nome: 'Produto novo', preco: 12, ativo: true } },
    carradasDisponiveis: [{ codigo: 1698, data: '2026-12-03', descricao: 'Carrada destino' }],
    carrada: { codigo: 1697, data: '2026-12-02', descricao: 'Carrada de teste',
      pedidos: [{ saida: 102, numero: '0020021', dataExpedicao: null }] },
    ...opcoes
  };
  const chamadas = [];
  const deps = {
    crypto,
    '../legado/pedido/pedidosLegado.service': {
      buscarDetalhePedido: async id => { chamadas.push(['ler_pedido', id]); return structuredClone(estado.pedido); },
      atualizarPedido: async (id, payload) => {
        chamadas.push(['alterar', id, structuredClone(payload)]);
        if (estado.falharAlteracao) throw new Error('Falha na resposta do bridge');
        return { ...structuredClone(estado.pedido), obs: payload.obs, itens: payload.itens,
          total: payload.itens.reduce((s, i) => s + i.quantidade * i.preco, 0) };
      },
      cancelarPedido: async (id, payload) => {
        chamadas.push(['cancelar', id, structuredClone(payload)]);
        return estado.retornoCancelamento || { ...structuredClone(estado.pedido), situacao: 'C' };
      },
      listarCarradasDisponiveis: async id => {
        chamadas.push(['carradas_disponiveis', id]); return { carradas: structuredClone(estado.carradasDisponiveis) };
      },
      alterarCarradaPedido: async (id, codigo) => {
        chamadas.push(['alterar_carrada', id, codigo]);
        return { carradaAtual: codigo === null ? null : estado.carradasDisponiveis.find(c => c.codigo === codigo),
          notificacoes: estado.notificacoesCarrada || [{ tipo: 'entrada', resultado: { enviado: true } }] };
      }
    },
    '../legado/vendedores/vendedores.service': {
      buscarVendedor: async id => { chamadas.push(['vendedor', id]); return id === 6 ? { favorecido: 6, nome: 'Outro vendedor' } : null; }
    },
    '../legado/pagamentos/pagamentos.service': {
      listarPedidosPorNumero: async numero => {
        chamadas.push(['ler_financeiro', numero]);
        if (estado.falharFinanceiro) throw new Error('Falha https://provedor.test/token/TOKEN_SECRETO');
        return structuredClone(estado.pagamentos === undefined ? [{
          saida: 102, numero: '0020021', totalPago: estado.pedido.totalPago
        }] : estado.pagamentos);
      }
    },
    '../produto/produto.service': {
      buscar: async id => { chamadas.push(['produto', id]); return structuredClone(estado.produtos[id]); }
    },
    '../legado/carradas/carradas.service': {
      buscarResumoCarrada: async codigo => { chamadas.push(['ler_carrada', codigo]); return structuredClone(estado.carrada); }
    },
    '../legado/carradas-progresso/carradas-progresso.service': {
      salvarDataExpedicao: async payload => {
        assert.equal(estado.centralAtiva, 'progresso_producao', 'expedição deve preservar o contexto da Central usado pela tela Progresso');
        chamadas.push(['expedicao', structuredClone(payload)]);
        return estado.retornoExpedicao || { dataExpedicao: payload.dataExpedicao, concluido: true,
          notificacao: { success: true }, audio: { success: true } };
      },
      enviarWhatsappCarradaLote: async () => { throw new Error('NUNCA enviar em lote'); }
    },
    '../whatsapp/central-controle.service': {
      comFuncionalidade: async (funcionalidade, executar) => {
        chamadas.push(['contexto_central', funcionalidade]);
        const anterior = estado.centralAtiva;
        estado.centralAtiva = funcionalidade;
        try { return await executar(); }
        finally { estado.centralAtiva = anterior; }
      }
    }
  };
  const source = fs.readFileSync(path.join(__dirname, '../src/services/integracao/mcpPedidoGestao.service.js'), 'utf8');
  const m = { exports: {} };
  new Function('require', 'module', 'exports', source)(name => {
    assert.ok(deps[name], 'dependência inesperada: ' + name);
    return deps[name];
  }, m, m.exports);
  const progresso = [];
  const contexto = { registrarProgresso: async registro => { progresso.push(structuredClone(registro)); chamadas.push(['progresso', registro.etapa, registro.estado]); } };
  const efeitos = () => chamadas.filter(c => ['alterar', 'cancelar', 'alterar_carrada', 'expedicao'].includes(c[0]));
  return { service: m.exports, estado, chamadas, progresso, contexto, efeitos };
}

test('prévia de alteração descreve mudança e não grava ou envia nada', async () => {
  const { service, efeitos } = carregarServico();
  const r = await service.prepararAlteracao({ id_mestre: 102, observacao: 'Nova observação' });
  assert.equal(r.payload.gravar.obs, 'Nova observação');
  assert.equal(r.resumo.pedido_atual.observacao, 'Observação inicial');
  assert.equal(r.resumo.proposto.total, 20);
  assert.deepEqual(efeitos(), []);
  assert.equal(Object.prototype.hasOwnProperty.call(r.payload.gravar, 'data'), false);
});

test('edição confirmada usa atualizarPedido e registra início antes da gravação', async () => {
  const { service, chamadas, contexto, efeitos } = carregarServico();
  const r = await service.prepararAlteracao({ id_mestre: 102, observacao: 'Nova observação' });
  const final = await service.executarAlteracao(r.payload, contexto);
  assert.equal(final.status, 'alterado');
  assert.equal(efeitos().length, 1);
  const escrita = chamadas.findIndex(c => c[0] === 'alterar');
  assert.deepEqual(chamadas[escrita - 1], ['progresso', 'alterar_pedido', 'iniciando']);
  assert.equal(chamadas[escrita][1], 102);
  assert.equal(chamadas[escrita][2].obs, 'Nova observação');
  assert.equal(chamadas[escrita][2].itens[0].item, 50);
});

test('mudança no pedido após prévia impede gravação e notificação', async () => {
  const { service, estado, contexto, efeitos, progresso } = carregarServico();
  const r = await service.prepararAlteracao({ id_mestre: 102, observacao: 'Nova observação' });
  estado.pedido.obs = 'Alterado por outro operador';
  await assert.rejects(service.executarAlteracao(r.payload, contexto), /mudou depois da prévia/);
  assert.deepEqual(efeitos(), []);
  assert.deepEqual(progresso, []);
});

test('itens novos usam cadastro real, lista completa e revalidam preço antes de executar', async () => {
  const { service, estado, contexto, efeitos } = carregarServico();
  const r = await service.prepararAlteracao({ id_mestre: 102, itens: [{ produto_id: 7, quantidade: 3 }] });
  assert.equal(r.payload.gravar.itens[0].item, 70);
  assert.equal(r.resumo.proposto.total, 36);
  assert.equal(r.resumo.lista_de_itens_substituida, true);
  assert.equal(efeitos().length, 0);
  estado.produtos[7].preco = 13;
  await assert.rejects(service.executarAlteracao(r.payload, contexto), /Produto ou preço mudou/);
  assert.equal(efeitos().length, 0);
});

test('edição bloqueia desconto abaixo do cadastro e total abaixo do já pago', async () => {
  const { service, estado, efeitos } = carregarServico();
  await assert.rejects(service.prepararAlteracao({
    id_mestre: 102, itens: [{ produto_id: 7, quantidade: 1, preco: 1 }]
  }), /preço inferior/);
  estado.pedido.totalPago = 15;
  await assert.rejects(service.prepararAlteracao({
    id_mestre: 102, itens: [{ produto_id: 7, quantidade: 1 }]
  }), /abaixo do valor já pago/);
  assert.equal(efeitos().length, 0);
});

test('edição aceita data válida e vendedor existente, rejeitando datas inexistentes', async () => {
  const { service, efeitos } = carregarServico();
  const r = await service.prepararAlteracao({ id_mestre: 102, data: '2026-12-02', vendedor: 6 });
  assert.equal(r.payload.gravar.data, '2026-12-02');
  assert.equal(r.payload.gravar.vendedor, 6);
  assert.equal(r.resumo.proposto.vendedor_nome, 'Outro vendedor');
  await assert.rejects(service.prepararAlteracao({ id_mestre: 102, data: '2026-02-30' }), /Data inválida/);
  await assert.rejects(service.prepararAlteracao({ id_mestre: 102, vendedor: 9 }), /Vendedor não encontrado/);
  assert.equal(efeitos().length, 0);
});

test('mudança de carrada mantém avisos da rotina existente e só executa após prévia', async () => {
  const { service, efeitos, contexto } = carregarServico();
  const r = await service.prepararAlteracao({ id_mestre: 102, carrada_codigo: 1698 });
  assert.match(r.resumo.aviso_whatsapp, /avisos automáticos/);
  assert.equal(efeitos().length, 0);
  const final = await service.executarAlteracao(r.payload, contexto);
  assert.deepEqual(efeitos().map(c => c[0]), ['alterar', 'alterar_carrada']);
  assert.equal(final.pedido.carrada.codigo, 1698);
  assert.equal(final.entrega_whatsapp_confirmada, false);
});

test('carrada removida das disponíveis após prévia impede todas as gravações', async () => {
  const { service, estado, contexto, efeitos } = carregarServico();
  const r = await service.prepararAlteracao({ id_mestre: 102, carrada_codigo: 1698 });
  estado.carradasDisponiveis = [];
  await assert.rejects(service.executarAlteracao(r.payload, contexto), /deixou de estar disponível/);
  assert.deepEqual(efeitos(), []);
});

test('cancelamento exige motivo e usa cancelarPedido do sistema apenas na execução', async () => {
  const { service, efeitos, contexto, chamadas } = carregarServico();
  await assert.rejects(service.prepararCancelamento({ id_mestre: 102, motivo: '  ' }), /motivo/);
  const r = await service.prepararCancelamento({ id_mestre: 102, motivo: 'Solicitação do cliente' });
  assert.equal(efeitos().length, 0);
  const final = await service.executarCancelamento(r.payload, contexto);
  assert.equal(final.status, 'cancelado');
  assert.deepEqual(efeitos(), [['cancelar', 102, { motivo: 'Solicitação do cliente' }]]);
  const indice = chamadas.findIndex(c => c[0] === 'cancelar');
  assert.deepEqual(chamadas[indice - 1], ['progresso', 'cancelar_pedido', 'iniciando']);
});

test('pedido cancelado ou não identificado não gera prévia de novas alterações', async () => {
  const { service, estado, efeitos } = carregarServico();
  estado.pedido.situacao = 'C';
  await assert.rejects(service.prepararCancelamento({ id_mestre: 102, motivo: 'Teste' }), /cancelado/);
  await assert.rejects(service.prepararAlteracao({ id_mestre: 102, observacao: 'Teste' }), /cancelado/);
  await assert.rejects(service.prepararExpedicao({ id_mestre: 102, data_expedicao: '2026-12-02' }), /cancelado/);
  await assert.rejects(service.prepararCancelamento({ id_mestre: '0020021', motivo: 'Teste' }), /código inteiro/);
  assert.equal(efeitos().length, 0);
});

test('cancelamento sem estado final confirmado lança erro depois da tentativa', async () => {
  const { service, estado, contexto, efeitos, progresso } = carregarServico();
  const r = await service.prepararCancelamento({ id_mestre: 102, motivo: 'Teste' });
  estado.retornoCancelamento = pedidoBase();
  await assert.rejects(service.executarCancelamento(r.payload, contexto), /estado final confirmado/);
  assert.equal(efeitos().length, 1);
  assert.equal(progresso[0].estado, 'iniciando');
});

test('prévia da expedição inclui efeito WhatsApp e não chama envio ou gravação', async () => {
  const { service, efeitos } = carregarServico();
  const r = await service.prepararExpedicao({ id_mestre: 102, data_expedicao: '2026-12-02' });
  assert.equal(r.resumo.data_proposta, '02/12/2026');
  assert.match(r.resumo.aviso_whatsapp, /notificação e o áudio/);
  assert.equal(r.resumo.envio_em_lote, false);
  assert.equal(efeitos().length, 0);
});

test('expedição usa exatamente salvarDataExpedicao com silencioso false, sem envio em lote', async () => {
  const { service, efeitos, contexto, chamadas } = carregarServico();
  const r = await service.prepararExpedicao({ id_mestre: 102, data_expedicao: '2026-12-02' });
  const final = await service.executarExpedicao(r.payload, contexto);
  assert.deepEqual(efeitos(), [['expedicao', {
    codigoCarrada: 1697, numeroPedido: '0020021', dataExpedicao: '02/12/2026', silencioso: false
  }]]);
  assert.equal(final.status, 'expedicao_registrada');
  assert.equal(final.entrega_whatsapp_confirmada, false);
  const indice = chamadas.findIndex(c => c[0] === 'expedicao');
  assert.ok(chamadas.slice(0, indice).some(c => c[0] === 'progresso'
    && c[1] === 'registrar_expedicao_e_aviso' && c[2] === 'iniciando'));
});

test('data de expedição alterada por outro operador invalida a prévia', async () => {
  const { service, estado, contexto, efeitos } = carregarServico();
  const r = await service.prepararExpedicao({ id_mestre: 102, data_expedicao: '2026-12-02' });
  estado.carrada.pedidos[0].dataExpedicao = '01/12/2026';
  await assert.rejects(service.executarExpedicao(r.payload, contexto), /data de expedição mudou/);
  assert.equal(efeitos().length, 0);
});

test('pedido que mudou de carrada após prévia não registra expedição', async () => {
  const { service, estado, contexto, efeitos } = carregarServico();
  const r = await service.prepararExpedicao({ id_mestre: 102, data_expedicao: '2026-12-02' });
  estado.pedido.carradaAtual.codigo = 1698;
  await assert.rejects(service.executarExpedicao(r.payload, contexto), /mudou depois da prévia/);
  assert.equal(efeitos().length, 0);
});

test('expedição recusa mesma data, identificação divergente e data desconhecida', async () => {
  const { service, estado, efeitos } = carregarServico();
  estado.carrada.pedidos[0].dataExpedicao = '02/12/2026';
  await assert.rejects(service.prepararExpedicao({ id_mestre: 102, data_expedicao: '2026-12-02' }), /já está registrada/);
  estado.carrada.pedidos[0].dataExpedicao = null;
  estado.carrada.pedidos[0].saida = 999;
  await assert.rejects(service.prepararExpedicao({ id_mestre: 102, data_expedicao: '2026-12-02' }), /identificadores/);
  estado.carrada.pedidos[0].saida = 102;
  delete estado.carrada.pedidos[0].dataExpedicao;
  await assert.rejects(service.prepararExpedicao({ id_mestre: 102, data_expedicao: '2026-12-02' }), /não informou a data/);
  assert.equal(efeitos().length, 0);
});

test('expedição sem confirmação da origem preserva tentativa para resultado incerto', async () => {
  const { service, estado, contexto, efeitos, progresso } = carregarServico();
  const r = await service.prepararExpedicao({ id_mestre: 102, data_expedicao: '2026-12-02' });
  estado.retornoExpedicao = { concluido: false };
  await assert.rejects(service.executarExpedicao(r.payload, contexto), /não confirmada/);
  assert.equal(efeitos().length, 1);
  assert.equal(progresso[0].estado, 'iniciando');
});

test('expedição bloqueia número duplicado na carrada antes de preparar ação', async () => {
  const { service, estado, efeitos } = carregarServico();
  estado.carrada.pedidos.push({ saida: 999, numero: '0020021', dataExpedicao: null });
  await assert.rejects(service.prepararExpedicao({
    id_mestre: 102, data_expedicao: '2026-12-02'
  }), /ambíguo|duplicado|único|mais de um/i);
  assert.equal(efeitos().length, 0);
});

test('expedição não converte campo indefinido ou indisponível em data vazia', async () => {
  for (const incompleto of [
    { dataExpedicao: undefined },
    { dataExpedicao: null, dataExpedicaoDisponivel: false }
  ]) {
    const { service, estado, efeitos } = carregarServico();
    Object.assign(estado.carrada.pedidos[0], incompleto);
    await assert.rejects(service.prepararExpedicao({
      id_mestre: 102, data_expedicao: '2026-12-02'
    }), /não informou|indisponível|não disponível|não pôde/i);
    assert.equal(efeitos().length, 0);
  }
});

test('expedição gravada com falha de WhatsApp é parcial e não expõe erro do provedor', async () => {
  const { service, estado, contexto, efeitos, progresso } = carregarServico();
  const r = await service.prepararExpedicao({ id_mestre: 102, data_expedicao: '2026-12-02' });
  estado.retornoExpedicao = {
    dataExpedicao: '02/12/2026', concluido: true,
    notificacao: { success: false, error: 'https://provedor.test/token/TOKEN_SECRETO' },
    audio: { success: false, erro: 'Falha https://provedor.test/token/TOKEN_SECRETO' }
  };
  const final = await service.executarExpedicao(r.payload, contexto);
  assert.equal(final.status, 'parcial');
  assert.equal(final.dataExpedicao, '02/12/2026');
  assert.equal(final.concluido, true);
  assert.equal(efeitos().length, 1);
  assert.doesNotMatch(JSON.stringify({ final, progresso }), /TOKEN_SECRETO|provedor\.test/);
});

test('troca de carrada confirmada com aviso não enviado retorna parcial sem revelar detalhes internos', async () => {
  const { service, estado, contexto, progresso } = carregarServico();
  const r = await service.prepararAlteracao({ id_mestre: 102, carrada_codigo: 1698 });
  estado.notificacoesCarrada = [{ tipo: 'entrada', resultado: {
    enviado: false, motivo: 'erro_envio', detalhe: 'https://provedor.test/token/TOKEN_SECRETO'
  } }];
  const final = await service.executarAlteracao(r.payload, contexto);
  assert.equal(final.status, 'parcial');
  assert.equal(final.pedido.carrada.codigo, 1698);
  assert.doesNotMatch(JSON.stringify({ final, progresso }), /TOKEN_SECRETO|provedor\.test/);
});

test('prévia financeira usa valor verificado em vez do zero padrão do detalhe', async () => {
  const { service, estado, chamadas } = carregarServico();
  estado.pedido.totalPago = 0;
  estado.pagamentos = [{ saida: 102, numero: '0020021', totalPago: 7 }];
  const r = await service.prepararAlteracao({ id_mestre: 102, observacao: 'Texto revisado' });
  assert.equal(r.resumo.pedido_atual.total_pago, 7);
  assert.equal(r.resumo.pedido_atual.financeiro_verificado, true);
  assert.equal(r.payload.financeiro, true);
  assert.ok(chamadas.some(c => c[0] === 'ler_financeiro' && c[1] === '0020021'));
});

test('fonte financeira ausente ou com valor não informado bloqueia alteração e cancelamento', async () => {
  for (const pagamentos of [
    [],
    [{ saida: 102, numero: '0020021' }],
    [{ saida: 102, numero: '0020021', totalPago: null }],
    [{ saida: 102, numero: '0020021', totalPago: '' }],
    [{ saida: 102, numero: '0020021', totalPago: 'invalido' }]
  ]) {
    const { service, efeitos } = carregarServico({ pagamentos });
    await assert.rejects(service.prepararAlteracao({ id_mestre: 102, observacao: 'Texto' }), /financeir|pago|pagamento/i);
    await assert.rejects(service.prepararCancelamento({ id_mestre: 102, motivo: 'Teste' }), /financeir|pago|pagamento/i);
    assert.equal(efeitos().length, 0);
  }
});

test('financeiro de outro pedido ou duplicado não autoriza a alteração', async () => {
  for (const pagamentos of [
    [{ saida: 999, numero: '0020021', totalPago: 0 }],
    [{ saida: 102, numero: '0099999', totalPago: 0 }],
    [{ numero: '0020021', totalPago: 0 }],
    [
      { saida: 102, numero: '0020021', totalPago: 0 },
      { saida: 102, numero: '0020021', totalPago: 1 }
    ]
  ]) {
    const { service, efeitos } = carregarServico({ pagamentos });
    await assert.rejects(service.prepararAlteracao({ id_mestre: 102, observacao: 'Texto' }), /financeir|pago|pagamento/i);
    assert.equal(efeitos().length, 0);
  }
});

test('falha da fonte financeira bloqueia prévia sem repassar detalhes internos', async () => {
  const { service, efeitos } = carregarServico({ falharFinanceiro: true });
  let erro;
  try { await service.prepararAlteracao({ id_mestre: 102, observacao: 'Texto' }); }
  catch (e) { erro = e; }
  assert.ok(erro);
  assert.doesNotMatch(erro.message, /TOKEN_SECRETO|provedor\.test/);
  assert.equal(efeitos().length, 0);
});

test('pagamento alterado entre prévia e confirmação invalida edição e cancelamento', async () => {
  for (const tipo of ['Alteracao', 'Cancelamento']) {
    const { service, estado, contexto, efeitos } = carregarServico({
      pagamentos: [{ saida: 102, numero: '0020021', totalPago: 0 }]
    });
    const r = await service['preparar' + tipo]({ id_mestre: 102, observacao: 'Texto', motivo: 'Teste' });
    estado.pagamentos[0].totalPago = 1;
    await assert.rejects(service['executar' + tipo](r.payload, contexto), /mudou depois da prévia/);
    assert.equal(efeitos().length, 0);
  }
});

test('registro de expedição usa sua rotina existente sem consulta financeira extra do adaptador', async () => {
  const { service, chamadas, contexto } = carregarServico({ falharFinanceiro: true });
  const r = await service.prepararExpedicao({ id_mestre: 102, data_expedicao: '2026-12-02' });
  await service.executarExpedicao(r.payload, contexto);
  assert.ok(!chamadas.some(c => c[0] === 'ler_financeiro'));
});

test('baixa para crédito bloqueia edição e cancelamento inclusive se surgir após a prévia', async () => {
  for (const vinculo of [
    { baixadoParaCredito: true },
    { statusFinanceiro: 'BAIXA_PARA_CREDITO' }
  ]) {
    for (const tipo of ['Alteracao', 'Cancelamento']) {
      const { service, estado, contexto, efeitos, progresso } = carregarServico({
        pagamentos: [{ saida: 102, numero: '0020021', totalPago: 0, ...vinculo }]
      });
      const args = { id_mestre: 102, observacao: 'Texto', motivo: 'Teste' };
      await assert.rejects(service['preparar' + tipo](args), /cr[eé]dito|v[ií]nculo financeiro/i);
      estado.pagamentos = [{ saida: 102, numero: '0020021', totalPago: 0 }];
      const r = await service['preparar' + tipo](args);
      Object.assign(estado.pagamentos[0], vinculo);
      await assert.rejects(service['executar' + tipo](r.payload, contexto), /cr[eé]dito|v[ií]nculo financeiro/i);
      assert.equal(efeitos().length, 0);
      assert.equal(progresso.length, 0);
    }
  }
});
