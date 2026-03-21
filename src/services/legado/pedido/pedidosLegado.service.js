const legadoBridgeService = require('../legadoBridge.service');

async function pesquisarPedidos(numero) {
  const response = await legadoBridgeService.get('/api/legado/pedidos', {
    numero
  });

  return response.data || [];
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
