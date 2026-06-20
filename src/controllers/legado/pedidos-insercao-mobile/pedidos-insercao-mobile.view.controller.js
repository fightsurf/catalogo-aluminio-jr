const path = require('path');

function abrirPaginaPedidosInsercaoMobile(req, res) {
  return res.sendFile(
    path.resolve(__dirname, '../../../../views/legado/pedidos-insercao-mobile/pedidos-insercao-mobile.html')
  );
}

module.exports = {
  abrirPaginaPedidosInsercaoMobile
};
