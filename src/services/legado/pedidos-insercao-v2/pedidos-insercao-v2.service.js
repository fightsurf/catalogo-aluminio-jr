const pedidosInsercaoService = require('../pedidos-insercao/pedidos-insercao.service');

async function inserirPedido(payload) {
  return pedidosInsercaoService.inserirPedido(payload);
}

module.exports = {
  inserirPedido
};
