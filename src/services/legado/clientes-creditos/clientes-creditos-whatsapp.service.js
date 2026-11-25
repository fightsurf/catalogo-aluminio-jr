'use strict';

const crypto = require('node:crypto');
const clientesService = require('../clientes/clientes.service');
const creditosService = require('./clientes-creditos.service');
const whatsappService = require('../../whatsapp/envio-whatsapp.service');
const controleWhatsapp = require('../../whatsapp/central-controle.service');

const LIMITE_MOVIMENTACOES = 5;
const enviosEmAndamento = new Set();

function erro(mensagem, statusCode = 400) {
  const exception = new Error(mensagem);
  exception.statusCode = statusCode;
  return exception;
}

function texto(value) {
  return String(value ?? '').trim();
}

function dataBrasil(value) {
  const valueString = texto(value);
  const iso = valueString.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo' }).format(value);
  }
  return '-';
}

function hojeBrasil() {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit', month: '2-digit', year: 'numeric'
  }).format(new Date());
}

function moeda(value) {
  return `R$ ${Number(value).toLocaleString('pt-BR', {
    minimumFractionDigits: 2, maximumFractionDigits: 2
  })}`;
}

function telefoneCliente(cliente) {
  const origem = [
    cliente?.telefone1, cliente?.telefonePrincipal, cliente?.telefone_principal,
    cliente?.telefone, cliente?.celular
  ].map(texto).find(Boolean);
  let telefone = whatsappService.normalizarTelefone(origem);
  if (/^\d{10,11}$/.test(telefone)) telefone = `55${telefone}`;
  if (!/^55[1-9]\d{9,10}$/.test(telefone)) {
    throw erro('O cliente não possui telefone válido para WhatsApp. Confira o cadastro.');
  }
  return telefone;
}

function formatarMensagem({ nome, lancamentos, saldo, dataEnvio }) {
  const linhas = [
    `*${dataEnvio}*`,
    `Cliente: *${nome}*`,
    '',
    '*Últimas movimentações financeiras (até 5):*'
  ];

  if (!lancamentos.length) {
    linhas.push('Nenhuma movimentação registrada.');
  } else {
    lancamentos.forEach((movimento, index) => {
      const debito = Number(movimento.valor_debito ?? movimento.valorDebito ?? 0);
      const credito = Number(movimento.valor_credito ?? movimento.valorCredito ?? 0);
      const descricao = texto(movimento.descricao || movimento.observacao || (
        debito > 0 ? 'Débito' : 'Pagamento / crédito'
      )).replace(/\s+/g, ' ').slice(0, 300);
      if (index > 0) linhas.push('');
      linhas.push(`${index + 1}. ${dataBrasil(movimento.data_lancamento)} - *${debito > 0 ? '+' : '−'} ${moeda(debito > 0 ? debito : credito)}* - ${descricao}`);
    });
  }

  linhas.push(
    '',
    saldo < -0.004
      ? `Crédito do cliente: *${moeda(Math.abs(saldo))}*`
      : `Total da dívida: *${moeda(Math.max(saldo, 0))}*`
  );
  return linhas.join('\n');
}

async function preparar(favorecidoParam) {
  const favorecido = Number(favorecidoParam);
  if (!Number.isSafeInteger(favorecido) || favorecido <= 0) {
    throw erro('Cliente inválido.');
  }

  const [cliente, extrato] = await Promise.all([
    clientesService.buscarCliente(favorecido),
    creditosService.buscarExtrato(favorecido)
  ]);

  if (!cliente) throw erro('Cliente não encontrado no cadastro.', 404);
  const idCadastro = Number(cliente.favorecido ?? cliente.FAVORECIDO ?? favorecido);
  if (idCadastro !== favorecido || Number(extrato?.favorecido) !== favorecido) {
    throw erro('O cadastro e o extrato não correspondem ao mesmo cliente.', 409);
  }

  const nome = texto(cliente.nome || cliente.razao_social || extrato.clienteNome);
  if (!nome || !Array.isArray(extrato?.lancamentos)) {
    throw erro('Dados do extrato incompletos. Nenhuma mensagem foi enviada.', 409);
  }
  const saldo = Number(extrato?.resumo?.saldo);
  if (!Number.isFinite(saldo)) {
    throw erro('Saldo do cliente indisponível. Nenhuma mensagem foi enviada.', 409);
  }
  const telefone = telefoneCliente(cliente);
  // buscarExtrato já fornece ordem decrescente (data e ID).
  const lancamentos = extrato.lancamentos.slice(0, LIMITE_MOVIMENTACOES);
  const mensagem = formatarMensagem({ nome, lancamentos, saldo, dataEnvio: hojeBrasil() });
  const confirmacao = crypto.createHash('sha256')
    .update(JSON.stringify({ favorecido, telefone, mensagem }))
    .digest('hex');

  return {
    favorecido, clienteNome: nome, telefone, mensagem,
    quantidadeMovimentacoes: lancamentos.length,
    saldo, confirmacao
  };
}

async function enviar(favorecidoParam, confirmacaoParam) {
  const confirmacao = texto(confirmacaoParam);
  if (!/^[a-f0-9]{64}$/.test(confirmacao)) {
    throw erro('Abra a prévia do WhatsApp antes de confirmar o envio.');
  }

  // Nova consulta impede enviar saldo desatualizado caso outro operador
  // registre dívida, pagamento, ajuste ou altere o telefone após a prévia.
  const previa = await preparar(favorecidoParam);
  if (confirmacao !== previa.confirmacao) {
    throw erro('O extrato ou o telefone mudou. Atualize a prévia antes de enviar.', 409);
  }
  if (enviosEmAndamento.has(confirmacao)) {
    throw erro('Esse extrato já está sendo enviado. Verifique o resultado antes de tentar novamente.', 409);
  }

  enviosEmAndamento.add(confirmacao);
  try {
    const envio = await controleWhatsapp.comFuncionalidade('pedidos_historico_financeiro', () =>
      whatsappService.enviarMensagem({
        telefone: previa.telefone,
        mensagem: previa.mensagem
      })
    );
    return {
      favorecido: previa.favorecido,
      telefone: envio.telefone || previa.telefone,
      quantidadeMovimentacoes: previa.quantidadeMovimentacoes,
      solicitado: true
    };
  } finally {
    enviosEmAndamento.delete(confirmacao);
  }
}

module.exports = { preparar, enviar, formatarMensagem, telefoneCliente };
