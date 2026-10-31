'use strict';

function fail(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  throw error;
}

function validarPagamentoEditavel(pagamento) {
  if (!pagamento) fail('Pagamento não encontrado nesta prestação.', 404);
  if (pagamento.credito_origem_id != null) {
    fail('Créditos automáticos não podem ser editados diretamente.', 409);
  }
  if (String(pagamento.origem_sistema || '').trim() || pagamento.origem_pagamento_codigo != null) {
    fail('Pagamento vinculado a pedidos. Altere o registro na tela de pagamentos dos pedidos.', 409);
  }
}

function validarAtualizacaoPagamento(data = {}) {
  const dataPagamento = String(data.data || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataPagamento)) fail('Informe uma data válida (AAAA-MM-DD).');
  const [ano, mes, dia] = dataPagamento.split('-').map(Number);
  const date = new Date(Date.UTC(ano, mes - 1, dia));
  if (date.getUTCFullYear() !== ano || date.getUTCMonth() + 1 !== mes || date.getUTCDate() !== dia) {
    fail('Data de pagamento inválida.');
  }
  if (data.valor == null || String(data.valor).trim() === '') fail('Informe o valor do pagamento.');
  const valor = Number(data.valor);
  if (!Number.isFinite(valor) || valor <= 0 || valor > 9999999999.99 ||
      Math.abs(valor * 100 - Math.round(valor * 100)) > 0.000001) {
    fail('O valor deve ser maior que zero e ter no máximo 2 casas decimais.');
  }
  const observacao = String(data.observacao ?? '').trim();
  if (observacao.length > 2000) fail('Observação excede o limite de 2000 caracteres.');
  return { data: dataPagamento, valor, observacao: observacao || null };
}

module.exports = { validarPagamentoEditavel, validarAtualizacaoPagamento };
