const path = require('path');

function abrirPaginaPedidosCliente(req, res) {
  return res.sendFile(
    path.resolve(
      __dirname,
      '../../../../views/legado/pedidos-cliente/pedidos-cliente.html'
    )
  );
}

module.exports = {
  abrirPaginaPedidosCliente
};
