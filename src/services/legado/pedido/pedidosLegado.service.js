const legadoBridgeService = require('../legadoBridge.service');

function limparTexto(valor) {
  if (typeof valor !== 'string') {
    return '';
  }

  return valor.trim();
}

async function pesquisarPedidos(numero) {
  const response = await legadoBridgeService.get('/api/legado/pedidos', {
    numero
  });

  const lista = Array.isArray(response.data) ? response.data : [];

  return lista.map((item) => ({
    idMestre: item?.idMestre ?? null,
    numero: item?.numero ?? '',
    data: item?.data ?? null,
    obs: item?.obs ?? null,
    total: item?.total ?? 0,
    vendedor: {
      codigo: item?.vendedor?.codigo ?? null,
      nome: limparTexto(item?.vendedor?.nome)
    },
    cliente: {
      nome: limparTexto(item?.cliente?.nome),
      cidade: limparTexto(item?.cliente?.cidade),
      uf: limparTexto(item?.cliente?.uf)
    }
  }));
}

async function buscarItensPedido(idMestre) {
  const response = await legadoBridgeService.get(
    `/api/legado/pedidos/${idMestre}/itens`
  );

  return response.data || null;
}

module.exports = {
  pesquisarPedidos,
  buscarItensPedido
};
