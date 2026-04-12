const legadoBridgeService = require('../legadoBridge.service');

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

module.exports = {
  pesquisarPedidos,
  buscarItensPedido,
  atualizarPedido
};
