'use strict';

// A mesma consulta financeira e o mesmo formato do botão preto de Pagamentos.
// Nenhum pagamento é calculado pelo MCP. O envio exige prévia e confirmação
// persistidas por mcpAcoesConfirmadas, com controle de tentativas incertas.
const { resolverCliente } = require('./mcpConsultaPedidos.service');
const historico = require('../legado/pedidos-cliente/pedidos-cliente.service');
const pagamentos = require('../legado/pagamentos/pagamentos.service');
const textoPagamento = require('../../../public/js/pagamentos-whatsapp-mensagem');
const envio = require('../whatsapp/envio-whatsapp.service');
const controle = require('../whatsapp/central-controle.service');

const TTL_MS = 10 * 60 * 1000;
const MAX_PEDIDOS = 10;

function falhar(mensagem) {
  const erro = new Error(mensagem);
  erro.isValidation = true;
  throw erro;
}
function texto(valor) { return String(valor ?? '').trim(); }
function numeroMonetario(valor, campo) {
  if (valor === null || valor === undefined || texto(valor) === '' || !Number.isFinite(Number(valor))) {
    falhar('O legado não confirmou ' + campo + '. Nada será enviado.');
  }
  return Number(valor);
}
function codigoCliente(valor) {
  const id = Number(valor);
  if (!Number.isSafeInteger(id) || id <= 0) falhar('Código de cliente ausente ou inválido.');
  return id;
}
function telefoneCliente(cliente) {
  // O botão preto da tela prioriza telefone1 e depois telefonePrincipal.
  let telefone = envio.normalizarTelefone(cliente?.telefone1 || cliente?.telefonePrincipal);
  if (/^\d{10,11}$/.test(telefone)) telefone = '55' + telefone;
  if (!/^55[1-9]\d{9,10}$/.test(telefone)) {
    falhar('Telefone 1 do cliente não é válido para WhatsApp. Confira o cadastro.');
  }
  return telefone;
}
function cancelado(p) {
  return p?.cancelado === true || ['C', 'CANCELADO', 'CANCELADA'].includes(texto(p?.situacao).toUpperCase());
}
function ordenarNumeros(a, b) {
  const numA = BigInt(texto(a.numero)), numB = BigInt(texto(b.numero));
  return numA === numB ? 0 : numA > numB ? -1 : 1;
}
function filtrosPagamento(item) {
  const saida = Number(item.saida ?? item.idMestre);
  const empresa = Number(item.empresa ?? -1);
  const pdv = Number(item.pdv ?? 0);
  if (!Number.isSafeInteger(saida) || saida < 1 || !Number.isSafeInteger(empresa) || !Number.isSafeInteger(pdv)) {
    falhar('O pedido ' + texto(item.numero) + ' não tem chaves completas para buscar pagamentos.');
  }
  return { empresa, saida, pdv };
}
function verificarDetalhe(detalhe, item, favorecido) {
  const pedido = detalhe?.pedido;
  if (!pedido || !pedido.cliente || codigoCliente(pedido.cliente.favorecido) !== favorecido ||
      !/^\d+$/.test(texto(pedido.numero)) || BigInt(texto(pedido.numero)) !== BigInt(texto(item.numero)) ||
      cancelado(pedido)) {
    falhar('O detalhe do pedido ' + texto(item.numero) + ' não corresponde ao cliente e pedido selecionados.');
  }
  if (!detalhe.resumo || !Array.isArray(detalhe.pagamentos)) {
    falhar('O pedido ' + texto(item.numero) + ' não retornou o resumo financeiro completo.');
  }
  const total = numeroMonetario(detalhe.resumo.totalVenda, 'o total do pedido ' + item.numero);
  const pago = numeroMonetario(detalhe.resumo.totalPago, 'o valor pago do pedido ' + item.numero);
  const saldo = numeroMonetario(detalhe.resumo.saldoRestante, 'o saldo do pedido ' + item.numero);
  if (total < 0 || pago < 0) falhar('Valores financeiros inválidos no pedido ' + texto(item.numero) + '.');
  if (detalhe.resumo.baixadoParaCredito) {
    numeroMonetario(detalhe.resumo.valorBaixadoParaCredito, 'a baixa para crédito do pedido ' + item.numero);
  }
  for (const pagamento of detalhe.pagamentos) {
    numeroMonetario(pagamento?.valor, 'um dos lançamentos do pedido ' + item.numero);
  }
  const telefone = telefoneCliente(pedido.cliente);
  const mensagem = textoPagamento.montarMensagem(detalhe);
  if (!mensagem || mensagem.length > 16000) falhar('Relatório de pagamentos vazio ou muito longo.');
  return { numero: texto(pedido.numero), filtros: filtrosPagamento(item), telefone, mensagem,
    total, total_pago: pago, saldo_restante: saldo, baixado_para_credito: detalhe.resumo.baixadoParaCredito === true };
}

async function selecionar(args = {}) {
  if (!args || typeof args !== 'object' || Array.isArray(args) ||
      Object.keys(args).some(k => !['cliente', 'favorecido', 'quantidade'].includes(k))) falhar('Parâmetros inválidos.');
  const quantidade = args.quantidade ?? 3;
  if (!Number.isInteger(quantidade) || quantidade < 1 || quantidade > MAX_PEDIDOS) {
    falhar('Escolha de 1 a ' + MAX_PEDIDOS + ' pedidos.');
  }
  if (args.cliente !== undefined && (typeof args.cliente !== 'string' || texto(args.cliente).length < 3 || texto(args.cliente).length > 120)) {
    falhar('Informe pelo menos três caracteres do nome do cliente.');
  }
  if (args.favorecido === undefined && !texto(args.cliente)) {
    falhar('Informe o cliente pelo nome ou código favorecido.');
  }
  const resolucao = await resolverCliente({ cliente: args.cliente, favorecido: args.favorecido });
  if (!resolucao.encontrado) falhar('Cliente não localizado no cadastro da Alumínio JR.');
  if (resolucao.necessita_escolha_cliente) {
    falhar('Há clientes homônimos. Consulte os clientes, escolha o código favorecido correto e prepare novamente.');
  }
  const cliente = resolucao.cliente;
  const favorecido = codigoCliente(cliente.favorecido);
  const historicoCliente = await historico.listarPedidosPorCliente(favorecido);
  if (!Array.isArray(historicoCliente?.dados) || historicoCliente?.consultaIncompleta === true) {
    falhar('Histórico de pedidos não confirmado como completo. Não é seguro selecionar os últimos números.');
  }
  if (historicoCliente.cliente?.favorecido != null &&
      codigoCliente(historicoCliente.cliente.favorecido) !== favorecido) {
    falhar('A origem retornou histórico de outro cliente.');
  }
  if (historicoCliente.dados.some(p => p.favorecido != null && codigoCliente(p.favorecido) !== favorecido)) {
    falhar('O histórico contém pedidos de outro cliente. Nada será enviado.');
  }
  const ativos = historicoCliente.dados.filter(p => !cancelado(p));
  if (ativos.some(p => !/^\d+$/.test(texto(p.numero)))) {
    falhar('O histórico possui número de pedido não numérico. Não é possível garantir a ordem sequencial.');
  }
  ativos.sort(ordenarNumeros);
  if (!ativos.length) falhar('Cliente não possui pedidos ativos para enviar.');
  const selecionados = ativos.slice(0, quantidade);
  // Nunca confundir dois pedidos distintos com número repetido.
  if (selecionados.some((p, i) => i > 0 && BigInt(texto(p.numero)) === BigInt(texto(selecionados[i - 1].numero)))) {
    falhar('O histórico possui números de pedido duplicados. Verifique antes de enviar.');
  }
  const relatorios = [];
  for (const item of selecionados) {
    const filtros = filtrosPagamento(item);
    const detalhe = await pagamentos.buscarPedidoComPagamentos(filtros);
    relatorios.push(verificarDetalhe(detalhe, item, favorecido));
  }
  if (new Set(relatorios.map(p => p.telefone)).size !== 1) {
    falhar('Os pedidos retornaram números de WhatsApp diferentes. Confirme o cadastro do cliente.');
  }
  return { cliente: { favorecido, nome: texto(cliente.nome), cidade: texto(cliente.cidade), uf: texto(cliente.uf) },
    quantidade, relatorios, cancelados_ignorados: historicoCliente.dados.length - ativos.length };
}

async function prepararEnvio(args = {}) {
  const selecao = await selecionar(args);
  await controle.verificar('pagamentos_mensagens');
  const expira_em = new Date(Date.now() + TTL_MS).toISOString();
  const primeiro = selecao.relatorios[0];
  const payload = { versao: 1, favorecido: selecao.cliente.favorecido, quantidade: selecao.quantidade,
    relatorios: selecao.relatorios, expira_em };
  const resumo = { acao: 'enviar_whatsapp_pagamentos_cliente', tipo: 'relatorio_pagamentos',
    cliente: selecao.cliente, destinatario: { telefone: primeiro.telefone, final: primeiro.telefone.slice(-4) },
    ordenacao: 'numero_do_pedido_decrescente', quantidade_solicitada: selecao.quantidade,
    quantidade_encontrada: selecao.relatorios.length, cancelados_ignorados: selecao.cancelados_ignorados,
    pedidos: selecao.relatorios.map(r => ({ numero: r.numero, total: r.total,
      total_pago: r.total_pago, saldo_restante: r.saldo_restante,
      baixado_para_credito: r.baixado_para_credito, mensagem: r.mensagem })),
    mensagens_separadas: true, envios_previstos: selecao.relatorios.length,
    expira_em, confirmacao_obrigatoria: true,
    aviso: 'Cada pedido será enviado como mensagem separada ao mesmo cliente, conforme o botão preto da tela de Pagamentos. Nenhum WhatsApp foi enviado. O aceite do provedor não confirma a entrega.' };
  return { payload, resumo };
}

async function executarEnvio(payload, contexto = {}) {
  if (typeof contexto.registrarProgresso !== 'function') falhar('O envio exige registro persistente de cada tentativa.');
  if (!payload || payload.versao !== 1 || !Array.isArray(payload.relatorios) ||
      !payload.relatorios.length || payload.relatorios.length > MAX_PEDIDOS ||
      !payload.expira_em || !Number.isFinite(new Date(payload.expira_em).getTime()) ||
      new Date(payload.expira_em).getTime() <= Date.now()) falhar('Prévia inválida ou expirada. Prepare novamente.');
  const atual = await selecionar({ favorecido: payload.favorecido, quantidade: payload.quantidade });
  if (JSON.stringify(atual.relatorios) !== JSON.stringify(payload.relatorios)) {
    falhar('Pedidos, pagamentos ou telefone mudaram desde a prévia. Nenhuma mensagem enviada; prepare novamente.');
  }
  await controle.verificar('pagamentos_mensagens');
  const resultados = [];
  let aceitos = 0;
  for (const [indice, pedido] of atual.relatorios.entries()) {
    const progresso = { ordem: indice + 1, total: atual.relatorios.length,
      numero_pedido: pedido.numero, tipo: 'relatorio_pagamentos', status: 'em_processamento' };
    // Grava primeiro: em timeout ou reinício não será feito reenvio cego.
    await contexto.registrarProgresso(progresso);
    try {
      await controle.verificar('pagamentos_mensagens');
      const resposta = await controle.comFuncionalidade('pagamentos_mensagens',
        () => envio.enviarMensagem({ telefone: pedido.telefone, mensagem: pedido.mensagem }));
      if (resposta?.success === false) throw new Error('Provedor não confirmou o aceite.');
      const zapi = resposta?.zapi || resposta;
      const aceito = { ...progresso, status: 'aceito_pelo_provedor',
        id_mensagem: zapi?.messageId || zapi?.id || null };
      resultados.push(aceito);
      aceitos++;
      await contexto.registrarProgresso(aceito);
    } catch (erro) {
      const naoEnviado = erro?.codigo === 'WHATSAPP_ENVIO_DESATIVADO' || erro?.isValidation === true;
      const falha = { ...progresso, status: naoEnviado ? 'nao_enviado' : 'resultado_incerto',
        motivo: naoEnviado ? 'Envio bloqueado pela Central de Controle.' : 'Resposta incerta: conferir provedor antes de qualquer nova ação.' };
      resultados.push(falha);
      await contexto.registrarProgresso(falha);
      return { status: aceitos > 0 ? 'parcial' : (naoEnviado ? 'nao_enviado' : 'resultado_incerto'),
        aceitos, total: atual.relatorios.length, resultados, telefone_final: pedido.telefone.slice(-4),
        entrega_confirmada: false, revisao_manual_necessaria: true,
        mensagem: 'Envio interrompido. Confira cada tentativa antes de preparar outro envio; não repetir automaticamente.' };
    }
  }
  return { status: 'aceito_pelo_provedor', aceitos, total: atual.relatorios.length,
    resultados, telefone_final: atual.relatorios[0].telefone.slice(-4), entrega_confirmada: false,
    mensagem: 'Relatórios aceitos pelo provedor. A entrega no WhatsApp ainda não foi confirmada.' };
}

module.exports = { prepararEnvio, executarEnvio, selecionar };
