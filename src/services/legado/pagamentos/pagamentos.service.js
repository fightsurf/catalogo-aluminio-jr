const clientesCreditosService = require('../clientes-creditos/clientes-creditos.service');
const prestacaoContasService = require('../../prestacao_contas/prestacao_contas.service');

function getBridgeBaseUrl() {
  const baseUrl = String(process.env.LEGADO_BRIDGE_URL || '').trim();

  if (!baseUrl) {
    throw new Error('LEGADO_BRIDGE_URL não configurada.');
  }

  return baseUrl.replace(/\/+$/, '');
}

async function request(path, options = {}) {
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };

  if (process.env.LEGADO_BRIDGE_API_KEY) {
    headers['x-api-key'] = process.env.LEGADO_BRIDGE_API_KEY;
  }

  const response = await fetch(`${getBridgeBaseUrl()}${path}`, {
    ...options,
    headers
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(data?.detalhe || data?.erro || data?.message || `Falha HTTP ${response.status}`);
    error.statusCode = response.status;
    throw error;
  }

  return data;
}

function criarErro(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function separarPayloadPrestacao(payload = {}) {
  const {
    prestacaoId,
    prestacao_id,
    adicionarPrestacao,
    adicionar_prestacao,
    ...payloadLegado
  } = payload || {};

  const valorId = prestacaoId ?? prestacao_id;
  let idPrestacao = null;

  if (valorId !== undefined && valorId !== null && String(valorId).trim() !== '') {
    const numero = Number(valorId);
    if (!Number.isInteger(numero) || numero <= 0) {
      throw criarErro('Selecione uma prestação de fornecedor válida.');
    }
    idPrestacao = numero;
  }

  const deveAdicionar = adicionarPrestacao === true
    || adicionar_prestacao === true
    || String(adicionarPrestacao || adicionar_prestacao || '').toLowerCase() === 'true'
    || idPrestacao !== null;

  if (deveAdicionar && idPrestacao === null) {
    throw criarErro('Selecione a prestação aberta que receberá este pagamento.');
  }

  return { payloadLegado, prestacaoId: idPrestacao };
}

function localizarPagamento(detalhe, codigo) {
  const pagamentos = Array.isArray(detalhe?.pagamentos) ? detalhe.pagamentos : [];
  return pagamentos.find((pagamento) => Number(pagamento.codigo) === Number(codigo)) || null;
}

function obterDataPrestacao(pagamento) {
  if (!pagamento) return null;
  return pagamento.condicao === 'C' ? pagamento.dataVencimento : pagamento.dataPgto;
}

function montarObservacaoPrestacao(detalhe, pagamento) {
  const numeroPedido = String(detalhe?.pedido?.numero || '').trim() || '-';
  const nomeCliente = String(detalhe?.pedido?.cliente?.nome || '').trim() || 'Cliente não identificado';
  const observacaoOriginal = String(pagamento?.observacao || '').trim();
  const partes = [`Pagamento do pedido ${numeroPedido} - ${nomeCliente}`];

  if (observacaoOriginal) {
    partes.push(observacaoOriginal);
  }

  return partes.join(' | ').slice(0, 500);
}

function montarDadosVinculo(prestacaoId, codigo, detalhe, pagamento) {
  if (!pagamento) {
    throw criarErro('O pagamento foi gravado no pedido, mas não foi localizado para vinculá-lo à prestação.', 500);
  }

  const dataPagamento = obterDataPrestacao(pagamento);
  if (!dataPagamento) {
    throw criarErro('O pagamento não possui uma data válida para lançamento na prestação.', 400);
  }

  return {
    prestacaoId,
    codigoPagamento: Number(codigo),
    empresa: detalhe?.pedido?.empresa ?? pagamento.empresa ?? -1,
    saida: detalhe?.pedido?.saida ?? pagamento.saida,
    pdv: detalhe?.pedido?.pdv ?? pagamento.pdv ?? 0,
    data: dataPagamento,
    valor: Number(pagamento.valor || 0),
    observacao: montarObservacaoPrestacao(detalhe, pagamento)
  };
}

function montarPayloadLegadoDoPagamento(pagamento, fallback = {}) {
  if (!pagamento) return null;

  return {
    empresa: pagamento.empresa ?? fallback.empresa ?? -1,
    saida: pagamento.saida ?? fallback.saida,
    pdv: pagamento.pdv ?? fallback.pdv ?? 0,
    condicao: pagamento.condicao,
    valor: pagamento.valor,
    dataVencimento: pagamento.dataVencimento || null,
    dataPgto: pagamento.dataPgto || null,
    numeroCheque: pagamento.numeroCheque || '',
    titularCheque: pagamento.titularCheque || '',
    observacao: pagamento.observacao || ''
  };
}

async function buscarDetalheLegado({ empresa = -1, saida, pdv = 0 }) {
  const params = new URLSearchParams({
    empresa: String(empresa),
    saida: String(saida),
    pdv: String(pdv)
  });
  const response = await request(`/api/pagamentos/pedido?${params.toString()}`);
  return response.dado || null;
}

async function excluirPagamentoLegado(codigo, filtros = {}) {
  const params = new URLSearchParams();
  Object.entries(filtros).forEach(([chave, valor]) => {
    if (valor !== undefined && valor !== null && `${valor}` !== '') {
      params.set(chave, String(valor));
    }
  });

  const sufixo = params.toString() ? `?${params.toString()}` : '';
  const response = await request(`/api/pagamentos/${encodeURIComponent(codigo)}${sufixo}`, {
    method: 'DELETE'
  });
  return response.dado || null;
}

async function listarPagamentosRealizados(filtros = {}) {
  const params = new URLSearchParams();

  if (filtros.dataInicial || filtros.data_inicial) {
    params.set('dataInicial', filtros.dataInicial || filtros.data_inicial);
  }

  if (filtros.dataFinal || filtros.data_final) {
    params.set('dataFinal', filtros.dataFinal || filtros.data_final);
  }

  const sufixo = params.toString() ? `?${params.toString()}` : '';
  const response = await request(`/api/pagamentos/realizados${sufixo}`);

  return {
    total: Number(response.total || 0),
    valorTotal: Number(response.valorTotal || 0),
    dados: Array.isArray(response.dados) ? response.dados : []
  };
}

async function listarClientes(nome) {
  const response = await request(`/api/pagamentos/clientes?nome=${encodeURIComponent(nome || '')}`);
  return response.dados || [];
}

async function listarPedidosPorCliente(favorecido) {
  const response = await request(`/api/pagamentos/pedidos/por-cliente/${encodeURIComponent(favorecido)}`);
  return clientesCreditosService.aplicarBaixasEmPedidos(response.dados || []);
}

async function listarPedidosPorData(data) {
  const response = await request(`/api/pagamentos/pedidos/por-data?data=${encodeURIComponent(data || '')}`);
  return clientesCreditosService.aplicarBaixasEmPedidos(response.dados || []);
}

async function listarPedidosPorNumero(numero) {
  const response = await request(`/api/pagamentos/pedidos/por-numero?numero=${encodeURIComponent(numero || '')}`);
  return clientesCreditosService.aplicarBaixasEmPedidos(response.dados || []);
}

async function enriquecerVinculosPrestacao(detalhe) {
  if (!detalhe || !Array.isArray(detalhe.pagamentos) || !detalhe.pagamentos.length) {
    return detalhe;
  }

  const codigos = detalhe.pagamentos
    .map((pagamento) => Number(pagamento.codigo))
    .filter((codigo) => Number.isInteger(codigo) && codigo > 0);

  if (!codigos.length) return detalhe;

  const vinculos = await prestacaoContasService.listarVinculosPagamentosPedido(codigos);
  const porCodigo = new Map(vinculos.map((vinculo) => [Number(vinculo.origem_pagamento_codigo), vinculo]));

  return {
    ...detalhe,
    pagamentos: detalhe.pagamentos.map((pagamento) => ({
      ...pagamento,
      prestacaoVinculada: porCodigo.get(Number(pagamento.codigo)) || null
    }))
  };
}

async function buscarPedidoComPagamentos({ empresa = -1, saida, pdv = 0 }) {
  const detalhe = await buscarDetalheLegado({ empresa, saida, pdv });
  const comBaixa = await clientesCreditosService.aplicarBaixaEmDetalhe(detalhe);
  return enriquecerVinculosPrestacao(comBaixa);
}

async function baixarPedidoParaCredito(payload = {}) {
  const empresa = payload.empresa ?? -1;
  const saida = payload.saida;
  const pdv = payload.pdv ?? 0;

  const detalhe = await buscarDetalheLegado({ empresa, saida, pdv });

  if (!detalhe?.pedido) {
    throw new Error('Pedido não encontrado para baixa para crédito.');
  }

  const baixaExistente = await clientesCreditosService.buscarBaixaPedido({ empresa, saida, pdv });
  if (baixaExistente) {
    return enriquecerVinculosPrestacao(await clientesCreditosService.aplicarBaixaEmDetalhe(detalhe));
  }

  const saldoRestante = Number(detalhe?.resumo?.saldoRestante || 0);
  if (!Number.isFinite(saldoRestante) || saldoRestante <= 0.009) {
    throw new Error('Este pedido não possui saldo devedor para baixa para crédito.');
  }

  await clientesCreditosService.criarBaixaParaCredito({
    detalhePedido: detalhe,
    valor: saldoRestante,
    observacao: payload.observacao || null
  });

  return enriquecerVinculosPrestacao(await clientesCreditosService.aplicarBaixaEmDetalhe(detalhe));
}

function montarObservacaoDistribuicaoPrestacao(data, aplicacao) {
  const numeroPedido = String(aplicacao?.numero || aplicacao?.saida || '').trim() || '-';
  const nomeCliente = String(data?.cliente?.nome || '').trim() || 'Cliente não identificado';
  const observacaoOriginal = String(data?.observacao || '').trim();
  const partes = [`Pagamento distribuído do pedido ${numeroPedido} - ${nomeCliente}`];

  if (observacaoOriginal) {
    partes.push(observacaoOriginal);
  }

  return partes.join(' | ').slice(0, 500);
}

async function desfazerDistribuicaoLegado(aplicacoes = []) {
  const falhas = [];

  for (const aplicacao of [...aplicacoes].reverse()) {
    const codigo = Number(aplicacao?.codigo);
    if (!Number.isInteger(codigo) || codigo <= 0) {
      falhas.push(`pedido ${aplicacao?.numero || aplicacao?.saida || '-'}`);
      continue;
    }

    try {
      await excluirPagamentoLegado(codigo, {
        empresa: aplicacao.empresa,
        saida: aplicacao.saida,
        pdv: aplicacao.pdv
      });
    } catch (error) {
      console.error(`Falha ao desfazer pagamento distribuído ${codigo}:`, error);
      falhas.push(`código ${codigo}`);
    }
  }

  return falhas;
}

async function distribuirPagamento(payload = {}) {
  const { payloadLegado, prestacaoId } = separarPayloadPrestacao(payload);

  let prestacao = null;
  if (prestacaoId) {
    prestacao = await prestacaoContasService.buscarPorId(prestacaoId);
    if (!prestacao) {
      throw criarErro('Prestação de fornecedor não encontrada.', 404);
    }

    const status = String(prestacao.status || 'ABERTA').trim().toUpperCase();
    if (status !== 'ABERTA') {
      throw criarErro('A prestação selecionada não está aberta para receber pagamentos.', 409);
    }
  }

  const response = await request('/api/pagamentos/distribuir', {
    method: 'POST',
    body: JSON.stringify(payloadLegado || {})
  });

  const data = response.dado || null;
  if (!prestacaoId || !data) {
    return data;
  }

  const aplicacoes = Array.isArray(data.aplicacoes) ? data.aplicacoes : [];
  const pagamentosVinculo = aplicacoes
    .filter((aplicacao) => Number(aplicacao?.valorAplicado || 0) > 0.009)
    .map((aplicacao) => ({
      codigoPagamento: Number(aplicacao.codigo),
      empresa: aplicacao.empresa,
      saida: aplicacao.saida,
      pdv: aplicacao.pdv,
      data: data.dataPgto,
      valor: Number(aplicacao.valorAplicado || 0),
      observacao: montarObservacaoDistribuicaoPrestacao(data, aplicacao)
    }));

  const codigosInvalidos = pagamentosVinculo.some((item) => !Number.isInteger(item.codigoPagamento) || item.codigoPagamento <= 0);
  if (!pagamentosVinculo.length || codigosInvalidos) {
    const falhasRollback = await desfazerDistribuicaoLegado(aplicacoes);
    const error = criarErro('O pagamento foi distribuído, mas os códigos dos lançamentos não puderam ser identificados para o vínculo com a prestação.', 500);
    if (falhasRollback.length) {
      error.message += ` Também não foi possível desfazer automaticamente: ${falhasRollback.join(', ')}.`;
    }
    throw error;
  }

  try {
    const vinculos = await prestacaoContasService.criarPagamentosVinculadosDistribuicao(prestacaoId, pagamentosVinculo);
    return {
      ...data,
      prestacaoVinculada: {
        id: Number(prestacao.id),
        titulo: prestacao.titulo || '',
        fornecedorNome: prestacao.fornecedor_nome || '',
        valorTotal: Number(data.valorRecebido || 0),
        quantidadeLancamentos: vinculos.length
      }
    };
  } catch (error) {
    const falhasRollback = await desfazerDistribuicaoLegado(aplicacoes);
    if (falhasRollback.length) {
      error.message = `${error.message} O vínculo com a prestação não foi gravado, mas parte da distribuição não pôde ser desfeita automaticamente (${falhasRollback.join(', ')}). Verifique os pedidos antes de tentar novamente.`;
    } else {
      error.message = `${error.message} A distribuição dos pedidos foi desfeita automaticamente.`;
    }
    throw error;
  }
}

async function criarPagamento(payload = {}) {
  const { payloadLegado, prestacaoId } = separarPayloadPrestacao(payload);
  const response = await request('/api/pagamentos', {
    method: 'POST',
    body: JSON.stringify(payloadLegado)
  });

  const detalhe = response.dado || null;
  if (!prestacaoId) {
    return enriquecerVinculosPrestacao(await clientesCreditosService.aplicarBaixaEmDetalhe(detalhe));
  }

  const codigo = Number(detalhe?.codigo);
  const pagamento = localizarPagamento(detalhe, codigo);

  try {
    const dadosVinculo = montarDadosVinculo(prestacaoId, codigo, detalhe, pagamento);
    await prestacaoContasService.criarPagamentoVinculadoPedido(dadosVinculo);
  } catch (error) {
    let rollbackConcluido = false;
    try {
      if (Number.isInteger(codigo) && codigo > 0 && detalhe?.pedido?.saida) {
        await excluirPagamentoLegado(codigo, {
          empresa: detalhe.pedido.empresa,
          saida: detalhe.pedido.saida,
          pdv: detalhe.pedido.pdv
        });
        rollbackConcluido = true;
      }
    } catch (rollbackError) {
      console.error('Falha ao desfazer pagamento do pedido após erro no vínculo com prestação:', rollbackError);
    }

    if (!rollbackConcluido) {
      error.message = `${error.message} O pagamento foi criado no pedido, mas não foi possível desfazê-lo automaticamente. Verifique o pagamento de código ${codigo || 'desconhecido'}.`;
    }
    throw error;
  }

  return enriquecerVinculosPrestacao(await clientesCreditosService.aplicarBaixaEmDetalhe(detalhe));
}

async function atualizarPagamento(codigo, payload = {}) {
  const { payloadLegado } = separarPayloadPrestacao(payload);
  const vinculo = await prestacaoContasService.buscarPagamentoVinculadoPedido(codigo);
  let pagamentoAnterior = null;

  if (vinculo) {
    if (String(vinculo.prestacao_status || '').trim().toUpperCase().startsWith('CONCLU')) {
      throw criarErro('Este pagamento está ligado a uma prestação concluída. Reabra a prestação antes de editar o pagamento.', 409);
    }

    const detalheAnterior = await buscarDetalheLegado({
      empresa: payloadLegado.empresa,
      saida: payloadLegado.saida,
      pdv: payloadLegado.pdv
    });
    pagamentoAnterior = localizarPagamento(detalheAnterior, codigo);
  }

  const response = await request(`/api/pagamentos/${encodeURIComponent(codigo)}`, {
    method: 'PUT',
    body: JSON.stringify(payloadLegado)
  });
  const detalheAtualizado = response.dado || null;

  if (vinculo) {
    const pagamentoAtualizado = localizarPagamento(detalheAtualizado, codigo);
    try {
      const dadosVinculo = montarDadosVinculo(vinculo.prestacao_id, codigo, detalheAtualizado, pagamentoAtualizado);
      await prestacaoContasService.atualizarPagamentoVinculadoPedido(codigo, dadosVinculo);
    } catch (error) {
      const payloadRollback = montarPayloadLegadoDoPagamento(pagamentoAnterior, payloadLegado);
      try {
        if (payloadRollback) {
          await request(`/api/pagamentos/${encodeURIComponent(codigo)}`, {
            method: 'PUT',
            body: JSON.stringify(payloadRollback)
          });
        }
      } catch (rollbackError) {
        console.error('Falha ao restaurar pagamento do pedido após erro de sincronização:', rollbackError);
        error.message = `${error.message} A edição foi gravada no pedido, mas não foi sincronizada com a prestação. Corrija antes de continuar.`;
      }
      throw error;
    }
  }

  return enriquecerVinculosPrestacao(await clientesCreditosService.aplicarBaixaEmDetalhe(detalheAtualizado));
}

async function excluirPagamento(codigo, filtros = {}) {
  const vinculo = await prestacaoContasService.buscarPagamentoVinculadoPedido(codigo);

  if (vinculo && String(vinculo.prestacao_status || '').trim().toUpperCase().startsWith('CONCLU')) {
    throw criarErro('Este pagamento está ligado a uma prestação concluída. Reabra a prestação antes de excluir o pagamento.', 409);
  }

  const detalheAnterior = vinculo
    ? await buscarDetalheLegado({
        empresa: filtros.empresa ?? vinculo.origem_empresa ?? -1,
        saida: filtros.saida ?? vinculo.origem_saida,
        pdv: filtros.pdv ?? vinculo.origem_pdv ?? 0
      })
    : null;
  const pagamentoAnterior = vinculo ? localizarPagamento(detalheAnterior, codigo) : null;

  const detalhe = await excluirPagamentoLegado(codigo, filtros);

  if (vinculo) {
    try {
      await prestacaoContasService.deletarPagamentoVinculadoPedido(codigo);
    } catch (error) {
      try {
        const payloadRestauracao = montarPayloadLegadoDoPagamento(pagamentoAnterior, filtros);
        if (payloadRestauracao) {
          const restaurado = await request('/api/pagamentos', {
            method: 'POST',
            body: JSON.stringify(payloadRestauracao)
          });
          const novoCodigo = Number(restaurado?.dado?.codigo);
          const novoPagamento = localizarPagamento(restaurado?.dado, novoCodigo);
          if (Number.isInteger(novoCodigo) && novoCodigo > 0 && novoPagamento) {
            await prestacaoContasService.atualizarOrigemPagamentoVinculado(codigo, {
              novoCodigoPagamento: novoCodigo,
              empresa: novoPagamento.empresa ?? payloadRestauracao.empresa,
              saida: novoPagamento.saida ?? payloadRestauracao.saida,
              pdv: novoPagamento.pdv ?? payloadRestauracao.pdv
            });
          }
        }
      } catch (rollbackError) {
        console.error('Falha ao restaurar pagamento excluído após erro de sincronização:', rollbackError);
        error.message = `${error.message} O pagamento foi excluído do pedido, mas permaneceu na prestação. Corrija antes de continuar.`;
      }
      throw error;
    }
  }

  return enriquecerVinculosPrestacao(await clientesCreditosService.aplicarBaixaEmDetalhe(detalhe));
}

module.exports = {
  listarPagamentosRealizados,
  listarClientes,
  listarPedidosPorCliente,
  listarPedidosPorData,
  listarPedidosPorNumero,
  buscarPedidoComPagamentos,
  baixarPedidoParaCredito,
  distribuirPagamento,
  criarPagamento,
  atualizarPagamento,
  excluirPagamento
};
