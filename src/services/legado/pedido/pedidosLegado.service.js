const legadoBridgeService = require('../legadoBridge.service');

function limparTexto(valor) {
  if (typeof valor !== 'string') {
    return '';
  }

  return valor.trim();
}

function normalizarPedido(item) {
  return {
    idMestre: item.idMestre ?? item.IDMESTRE ?? item.idmestre ?? null,
    numero: item.numero ?? item.NUMERO ?? null,
    data: item.data ?? item.DATA ?? null,
    total: Number(item.total ?? item.TOTAL ?? 0),
    obs: item.obs ?? item.OBS ?? '',
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

async function pesquisarPedidos(filtros = {}) {
  const response = await legadoBridgeService.get('/api/legado/pedidos', {
    numero: filtros.numero,
    cliente: filtros.cliente,
    data: filtros.data
  });

  const dados = Array.isArray(response.data) ? response.data : [];
  return dados.map(normalizarPedido);
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
    itens: Array.isArray(pedido.itens)
      ? pedido.itens.map((item) => ({
          descricao: limparTexto(item?.descricao),
          quantidade: Number(item?.quantidade ?? 0),
          preco: Number(item?.preco ?? 0),
          subtotal: Number(item?.subtotal ?? 0)
        }))
      : []
  };
}

module.exports = {
  pesquisarPedidos,
  buscarItensPedido
};
