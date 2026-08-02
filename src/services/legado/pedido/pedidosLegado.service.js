const legadoBridgeService = require('../legadoBridge.service');
const envioWhatsappService = require('../../whatsapp/envio-whatsapp.service');
const pedidoPdfService = require('./pedidoPdf.service');
const prestacaoContasService = require('../../prestacao_contas/prestacao_contas.service');
const clientesCreditosService = require('../clientes-creditos/clientes-creditos.service');
const volumeService = require('../../volume/volume.service');

function limparTexto(valor) {
  if (typeof valor !== 'string') {
    return '';
  }

  return valor.trim();
}

function normalizarNumeroPedido(valor) {
  return String(valor || '').trim();
}

function numeroSeguro(valor, fallback = 0) {
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : fallback;
}

function normalizarTelefonePedido(pedido) {
  return limparTexto(
    pedido?.cliente?.telefonePrincipal
      || pedido?.cliente?.telefone1
      || pedido?.cliente?.fone1
      || pedido?.telefonePrincipal
      || pedido?.telefone
      || ''
  );
}

function montarNomeArquivoPedido(pedido) {
  const numeroPedido = normalizarNumeroPedido(pedido?.numero) || String(pedido?.idMestre || 'pedido');
  const numeroLimpo = numeroPedido.replace(/[^a-zA-Z0-9_-]+/g, '_');
  return `Pedido_${numeroLimpo}_Aluminio_JR.pdf`;
}

function montarLegendaPdfPedido(pedido) {
  const numeroPedido = normalizarNumeroPedido(pedido?.numero) || '-';
  return `Pedido Alumínio JR ${numeroPedido}`;
}

function normalizarCarrada(item) {
  if (!item) {
    return null;
  }

  const codigo = item.codigo ?? item.CODIGO ?? null;

  if (!codigo) {
    return null;
  }

  return {
    codigo,
    data: item.data ?? item.DATA ?? null,
    descricao: item.descricao ?? item.DESCRICAO ?? ''
  };
}


function formatarDataParaMensagem(valor) {
  if (!valor) {
    return '';
  }

  const data = new Date(valor);

  if (Number.isNaN(data.getTime())) {
    return limparTexto(valor).slice(0, 10);
  }

  return data.toLocaleDateString('pt-BR', {
    timeZone: 'America/Fortaleza'
  });
}

function montarMensagemCarrada({ tipo, pedido, carrada }) {
  const numeroPedido = limparTexto(pedido?.numero);
  const nomeCliente = limparTexto(pedido?.cliente?.nome);
  const dataCarrada = formatarDataParaMensagem(carrada?.data);
  const descricaoCarrada = limparTexto(carrada?.descricao);
  const acao = tipo === 'saida' ? 'saiu' : 'entrou';

  return [
    `🚚 Pedido: ${numeroPedido}`,
    `Cliente: ${nomeCliente}`,
    '',
    `Seu pedido ${acao} na produção da carrada do dia ${dataCarrada}`,
    descricaoCarrada
  ]
    .filter((linha, indice, linhas) => {
      if (indice === linhas.length - 1) {
        return Boolean(linha);
      }
      return true;
    })
    .join('\n');
}

async function enviarNotificacaoCarrada({ tipo, pedido, carrada }) {
  const telefone = limparTexto(pedido?.cliente?.telefonePrincipal);

  if (!telefone) {
    return { enviado: false, motivo: 'sem_telefone' };
  }

  const mensagem = montarMensagemCarrada({ tipo, pedido, carrada });

  try {
    await envioWhatsappService.enviarMensagem({ telefone, mensagem });
    return { enviado: true };
  } catch (error) {
    return { enviado: false, motivo: 'erro_envio', detalhe: error.message };
  }
}

function carradasSaoDiferentes(carradaA, carradaB) {
  return String(carradaA?.codigo || '') !== String(carradaB?.codigo || '');
}

async function enviarNotificacoesAlteracaoCarrada({ pedido, carradaAnterior, carradaAtual }) {
  const notificacoes = [];

  if (!carradasSaoDiferentes(carradaAnterior, carradaAtual)) {
    return notificacoes;
  }

  if (carradaAnterior?.codigo) {
    notificacoes.push({
      tipo: 'saida',
      resultado: await enviarNotificacaoCarrada({ tipo: 'saida', pedido, carrada: carradaAnterior })
    });
  }

  if (carradaAtual?.codigo) {
    notificacoes.push({
      tipo: 'entrada',
      resultado: await enviarNotificacaoCarrada({ tipo: 'entrada', pedido, carrada: carradaAtual })
    });
  }

  return notificacoes;
}

function normalizarPedido(item) {
  return {
    idMestre: item.idMestre ?? item.IDMESTRE ?? item.idmestre ?? null,
    numero: item.numero ?? item.NUMERO ?? null,
    data: item.data ?? item.DATA ?? null,
    total: Number(item.total ?? item.TOTAL ?? 0),
    totalPago: Number(item.totalPago ?? item.TOTAL_PAGO ?? 0),
    saldoRestante: Number(item.saldoRestante ?? item.SALDO_RESTANTE ?? 0),
    empresa: item.empresa ?? item.EMPRESA ?? -1,
    saida: item.saida ?? item.SAIDA ?? item.idMestre ?? item.IDMESTRE ?? item.idmestre ?? null,
    pdv: item.pdv ?? item.PDV ?? 0,
    obs: item.obs ?? item.OBS ?? '',
    volumes: Number(item.volumes ?? item.VOLUMES ?? 0),
    carradaAtual: normalizarCarrada(item.carradaAtual ?? item.CARRADA_ATUAL ?? null),
    vendedor: {
      favorecido:
        item?.vendedor?.favorecido ??
        item?.VENDEDOR ??
        item?.vendedor ??
        null,
      nome:
        item?.vendedor?.nome ??
        item?.V_NOME ??
        item?.v_nome ??
        ''
    },
    cliente: {
      nome:
        item?.cliente?.nome ??
        item?.F_NOME ??
        item?.f_nome ??
        '',
      cidade:
        item?.cliente?.cidade ??
        item?.F_CIDADE ??
        item?.f_cidade ??
        '',
      uf:
        item?.cliente?.uf ??
        item?.F_UF ??
        item?.f_uf ??
        '',
      telefonePrincipal:
        item?.cliente?.telefonePrincipal ??
        item?.F_TELEFONE_PRINCIPAL ??
        item?.f_telefone_principal ??
        item?.F_FONE1 ??
        item?.f_fone1 ??
        ''
    }
  };
}

function normalizarResumoPagamento(item, numeroPedidoOriginal) {
  return {
    numero: normalizarNumeroPedido(item?.numero ?? item?.NUMERO ?? numeroPedidoOriginal),
    totalPago: numeroSeguro(item?.totalPago ?? item?.TOTAL_PAGO ?? 0),
    saldoRestante: numeroSeguro(item?.saldoRestante ?? item?.SALDO_RESTANTE ?? 0),
    empresa: item?.empresa ?? item?.EMPRESA ?? -1,
    saida: item?.saida ?? item?.SAIDA ?? null,
    pdv: item?.pdv ?? item?.PDV ?? 0
  };
}

function escolherResumoPagamento(resumos, pedidoBase) {
  if (!Array.isArray(resumos) || !resumos.length) {
    return null;
  }

  const numeroPedido = normalizarNumeroPedido(pedidoBase?.numero);
  const idMestre = String(pedidoBase?.idMestre ?? '').trim();

  const resumoExatoPorSaida = resumos.find((item) => {
    const resumo = normalizarResumoPagamento(item, numeroPedido);
    return idMestre && String(resumo.saida ?? '').trim() === idMestre;
  });

  if (resumoExatoPorSaida) {
    return normalizarResumoPagamento(resumoExatoPorSaida, numeroPedido);
  }

  const resumoExatoPorNumero = resumos.find((item) => {
    const resumo = normalizarResumoPagamento(item, numeroPedido);
    return resumo.numero === numeroPedido;
  });

  if (resumoExatoPorNumero) {
    return normalizarResumoPagamento(resumoExatoPorNumero, numeroPedido);
  }

  return normalizarResumoPagamento(resumos[0], numeroPedido);
}

async function buscarResumoPagamentoPorNumero(numeroPedido, pedidoBase) {
  const numeroNormalizado = normalizarNumeroPedido(numeroPedido);

  if (!numeroNormalizado) {
    return null;
  }

  try {
    const response = await legadoBridgeService.get('/api/pagamentos/pedidos/por-numero', {
      numero: numeroNormalizado
    });

    const dados = Array.isArray(response?.dados) ? response.dados : [];
    return escolherResumoPagamento(dados, pedidoBase);
  } catch (error) {
    return null;
  }
}

async function enriquecerPedidosComPagamentos(pedidos) {
  const mapaResumoPorNumero = new Map();
  const pedidosNormalizados = Array.isArray(pedidos) ? pedidos : [];

  await Promise.all(
    pedidosNormalizados.map(async (pedido) => {
      const numeroPedido = normalizarNumeroPedido(pedido?.numero);

      if (!numeroPedido || mapaResumoPorNumero.has(numeroPedido)) {
        return;
      }

      const resumo = await buscarResumoPagamentoPorNumero(numeroPedido, pedido);
      mapaResumoPorNumero.set(numeroPedido, resumo);
    })
  );

  return pedidosNormalizados.map((pedido) => {
    const numeroPedido = normalizarNumeroPedido(pedido?.numero);
    const resumo = mapaResumoPorNumero.get(numeroPedido);

    return {
      ...pedido,
      totalPago: numeroSeguro(resumo?.totalPago, 0),
      saldoRestante: numeroSeguro(
        resumo?.saldoRestante,
        Math.max(numeroSeguro(pedido?.total, 0) - numeroSeguro(resumo?.totalPago, 0), 0)
      ),
      empresa: resumo?.empresa ?? pedido?.empresa ?? -1,
      saida: resumo?.saida ?? pedido?.saida ?? pedido?.idMestre ?? null,
      pdv: resumo?.pdv ?? pedido?.pdv ?? 0
    };
  });
}

async function pesquisarPedidos(filtros = {}) {
  const response = await legadoBridgeService.get('/api/legado/pedidos', {
    numero: filtros.numero,
    cliente: filtros.cliente,
    data: filtros.data
  });

  const dados = Array.isArray(response.data) ? response.data : [];
  const pedidos = dados.map(normalizarPedido);

  return enriquecerPedidosComPagamentos(pedidos);
}

async function buscarItensPedido(idMestre) {
  const response = await legadoBridgeService.get(
    `/api/legado/pedidos/${idMestre}/itens`
  );

  const pedido = response.data || null;

  if (!pedido) {
    return null;
  }

  return {
    carradaAtual: normalizarCarrada(pedido.carradaAtual),
    itens: Array.isArray(pedido.itens)
      ? pedido.itens.map((item) => ({
          saidaItem: item?.saidaItem ?? item?.SAIDAITEM ?? null,
          sequencia: item?.sequencia ?? item?.SEQUENCIA ?? null,
          item: item?.item ?? item?.ITEM ?? null,
          descricao: limparTexto(item?.descricao),
          quantidade: Number(item?.quantidade ?? 0),
          preco: Number(item?.preco ?? 0),
          subtotal: Number(item?.subtotal ?? 0)
        }))
      : []
  };
}

async function buscarDetalhePedido(idMestre) {
  const response = await legadoBridgeService.get(
    `/api/legado/pedidos/${idMestre}/detalhe`
  );

  const pedido = response.data || null;

  if (!pedido) {
    return null;
  }

  return {
    ...normalizarPedido({
      ...pedido,
      carradaAtual: pedido?.carradaAtual || null
    }),
    itens: Array.isArray(pedido?.itens)
      ? pedido.itens.map((item) => ({
          saidaItem: item?.saidaItem ?? item?.SAIDAITEM ?? null,
          sequencia: item?.sequencia ?? item?.SEQUENCIA ?? null,
          item: item?.item ?? item?.ITEM ?? null,
          descricao: limparTexto(item?.descricao),
          quantidade: Number(item?.quantidade ?? 0),
          preco: Number(item?.preco ?? 0),
          subtotal: Number(item?.subtotal ?? item?.subtotalitem ?? 0)
        }))
      : []
  };
}

async function enviarPdfWhatsappPedido(idMestre) {
  const pedido = await buscarDetalhePedido(idMestre);

  if (!pedido) {
    throw new Error('Pedido não encontrado.');
  }

  const telefone = normalizarTelefonePedido(pedido);

  if (!telefone) {
    throw new Error('Telefone do cliente não encontrado no pedido.');
  }

  const pdfBuffer = pedidoPdfService.gerarPdfPedido(pedido);
  const documentoBase64 = pdfBuffer.toString('base64');
  const nomeArquivo = montarNomeArquivoPedido(pedido);
  const legenda = montarLegendaPdfPedido(pedido);

  const envio = await envioWhatsappService.enviarDocumentoPdf({
    telefone,
    documentoBase64,
    nomeArquivo,
    legenda
  });

  return {
    success: true,
    pedido: {
      idMestre: pedido.idMestre,
      numero: pedido.numero,
      cliente: pedido.cliente,
      total: pedido.total
    },
    telefone: envio.telefone,
    nomeArquivo,
    zapi: envio.zapi
  };
}

async function listarCarradasDisponiveis(idMestre) {
  const response = await legadoBridgeService.get(
    `/api/legado/pedidos/${idMestre}/carradas-disponiveis`
  );

  const data = response?.data || {};

  return {
    carradaAtual: normalizarCarrada(data.carradaAtual),
    carradas: Array.isArray(data.carradas)
      ? data.carradas.map(normalizarCarrada).filter(Boolean)
      : []
  };
}

async function alterarCarradaPedido(idMestre, codigoCarrada) {
  const response = await legadoBridgeService.put(
    `/api/legado/pedidos/${idMestre}/carrada`,
    { codigoCarrada: codigoCarrada || null }
  );

  const data = response?.data || {};
  const pedido = normalizarPedido(data.pedido || {});
  const carradaAnterior = normalizarCarrada(data.carradaAnterior);
  const carradaAtual = normalizarCarrada(data.carradaAtual);

  const notificacoes = await enviarNotificacoesAlteracaoCarrada({
    pedido,
    carradaAnterior,
    carradaAtual
  });

  return {
    pedido: {
      ...pedido,
      carradaAtual
    },
    carradaAnterior,
    carradaAtual,
    notificacoes
  };
}

async function calcularESalvarVolumesPedido(idMestre) {
  const pedido = await buscarDetalhePedido(idMestre);

  if (!pedido) {
    throw new Error('Pedido não encontrado.');
  }

  if (!Array.isArray(pedido.itens) || !pedido.itens.length) {
    throw new Error('O pedido não possui itens para calcular volumes.');
  }

  const calculo = await volumeService.calcular({
    itens: pedido.itens.map((item) => ({
      item: item.item,
      nome: item.descricao,
      quantidade: Number(item.quantidade || 0)
    }))
  });

  const response = await legadoBridgeService.put(
    `/api/legado/pedidos/${idMestre}/volumes`,
    { volumes: calculo.total_volumes }
  );

  const salvo = response?.data || {};
  const volumes = Number(salvo?.volumes ?? calculo.total_volumes ?? 0);

  return {
    idMestre: salvo?.idMestre ?? pedido.idMestre,
    saida: salvo?.saida ?? pedido.saida,
    numero: salvo?.numero ?? pedido.numero,
    volumes,
    totalVolumes: volumes,
    itens: calculo.itens
  };
}


async function atualizarPedido(idMestre, payload = {}) {
  const response = await legadoBridgeService.put(
    `/api/legado/pedidos/${idMestre}`,
    payload
  );

  const pedido = response?.data || null;

  if (!pedido) {
    return null;
  }

  return {
    ...normalizarPedido({
      ...pedido,
      carradaAtual: pedido?.carradaAtual || null
    }),
    itens: Array.isArray(pedido?.itens)
      ? pedido.itens.map((item) => ({
          saidaItem: item?.saidaItem ?? item?.SAIDAITEM ?? null,
          sequencia: item?.sequencia ?? item?.SEQUENCIA ?? null,
          item: item?.item ?? item?.ITEM ?? null,
          descricao: limparTexto(item?.descricao),
          quantidade: Number(item?.quantidade ?? 0),
          preco: Number(item?.preco ?? 0),
          subtotal: Number(item?.subtotal ?? item?.subtotalitem ?? 0)
        }))
      : []
  };
}

async function copiarPedido(idMestre, payload = {}) {
  const response = await legadoBridgeService.post(
    `/api/legado/pedidos/${idMestre}/copiar`,
    payload
  );

  const data = response?.data || {};
  const pedidoNovo = normalizarPedidoComItensParticao(data.pedidoNovo);

  if (!pedidoNovo) {
    throw new Error('A API local não retornou o novo pedido copiado.');
  }

  return {
    ...data,
    pedidoNovo: {
      ...pedidoNovo,
      totalPago: 0,
      saldoRestante: Number(pedidoNovo.total || 0),
      volumes: 0
    },
    carradaDestino: normalizarCarrada(data.carradaDestino)
  };
}


function normalizarPedidoComItensParticao(pedido) {
  if (!pedido) return null;

  return {
    ...normalizarPedido({
      ...pedido,
      carradaAtual: pedido?.carradaAtual || null
    }),
    itens: Array.isArray(pedido?.itens)
      ? pedido.itens.map((item) => ({
          saidaItem: item?.saidaItem ?? item?.SAIDAITEM ?? null,
          sequencia: item?.sequencia ?? item?.SEQUENCIA ?? null,
          item: item?.item ?? item?.ITEM ?? null,
          descricao: limparTexto(item?.descricao),
          quantidade: Number(item?.quantidade ?? 0),
          preco: Number(item?.preco ?? 0),
          subtotal: Number(item?.subtotal ?? item?.subtotalitem ?? 0)
        }))
      : []
  };
}

async function particionarPedido(idMestre, payload = {}) {
  const response = await legadoBridgeService.post(
    `/api/legado/pedidos/${idMestre}/particionar`,
    payload
  );

  const data = response?.data || {};
  let sincronizacaoPrestacoes = null;
  let avisoSincronizacaoPrestacoes = null;

  try {
    sincronizacaoPrestacoes = await prestacaoContasService.sincronizarParticaoPagamentosPedido({
      pagamentos: data.pagamentos || {},
      pedidoOriginal: data.pedidoOriginal || {},
      pedidoNovo: data.pedidoNovo || {}
    });
  } catch (error) {
    avisoSincronizacaoPrestacoes = `A divisão foi concluída, mas os vínculos com prestações precisam ser conferidos: ${error.message}`;
    console.error(avisoSincronizacaoPrestacoes);
  }

  let sincronizacaoBaixaCredito = null;
  let avisoSincronizacaoBaixaCredito = null;

  try {
    sincronizacaoBaixaCredito = await clientesCreditosService.sincronizarParticaoBaixaCredito({
      pagamentos: data.pagamentos || {},
      pedidoOriginal: data.pedidoOriginal || {},
      pedidoNovo: data.pedidoNovo || {}
    });
  } catch (error) {
    avisoSincronizacaoBaixaCredito = `A divisão foi concluída, mas a baixa para crédito precisa ser conferida: ${error.message}`;
    console.error(avisoSincronizacaoBaixaCredito);
  }

  const originalBase = normalizarPedidoComItensParticao(data.pedidoOriginal);
  const novoBase = normalizarPedidoComItensParticao(data.pedidoNovo);
  const enriquecidos = await enriquecerPedidosComPagamentos(
    [originalBase, novoBase].filter(Boolean)
  );
  const porSaida = new Map(
    enriquecidos.map((pedido) => [String(pedido?.saida ?? pedido?.idMestre ?? ''), pedido])
  );

  return {
    ...data,
    sincronizacaoPrestacoes,
    avisoSincronizacaoPrestacoes,
    sincronizacaoBaixaCredito,
    avisoSincronizacaoBaixaCredito,
    pedidoOriginal: originalBase
      ? {
          ...originalBase,
          ...(porSaida.get(String(originalBase.saida ?? originalBase.idMestre ?? '')) || {})
        }
      : null,
    pedidoNovo: novoBase
      ? {
          ...novoBase,
          ...(porSaida.get(String(novoBase.saida ?? novoBase.idMestre ?? '')) || {})
        }
      : null
  };
}

module.exports = {
  pesquisarPedidos,
  buscarItensPedido,
  buscarDetalhePedido,
  listarCarradasDisponiveis,
  alterarCarradaPedido,
  calcularESalvarVolumesPedido,
  atualizarPedido,
  copiarPedido,
  particionarPedido,
  enviarPdfWhatsappPedido
};
