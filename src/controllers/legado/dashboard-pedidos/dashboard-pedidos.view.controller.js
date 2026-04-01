const path = require('path');

function abrirPaginaDashboardPedidos(req, res) {
  return res.sendFile(
    path.resolve(__dirname, '../../../../views/legado/dashboard-pedidos/dashboard-pedidos.html')
  );
}

module.exports = {
  abrirPaginaDashboardPedidos
};
