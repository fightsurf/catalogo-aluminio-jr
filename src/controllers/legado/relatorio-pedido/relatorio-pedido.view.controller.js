const path = require('path');

function abrirRelatorioPedido(req, res) {
  return res.sendFile(
    path.resolve(__dirname, '../../../../views/legado/relatorio-pedido/relatorio-pedido.html')
  );
}

module.exports = {
  abrirRelatorioPedido
};
