const path = require('path');


function abrirPaginaPedidosMobile(req, res) {
  return res.sendFile(
    path.resolve(__dirname, '../../../../views/legado/pedido/pedidos-mobile.html')
  );
}

function abrirPaginaPedidosLegado(req, res) {
  return res.sendFile(
    path.resolve(__dirname, '../../../../views/legado/pedido/pedidos-legado.html')
  );
}

module.exports = {
  abrirPaginaPedidosLegado,
  abrirPaginaPedidosMobile
};
