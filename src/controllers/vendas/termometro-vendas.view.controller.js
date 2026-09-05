const path = require('path');

function abrirPaginaTermometroVendas(req, res) {
  return res.sendFile(
    path.join(__dirname, '../../../views/vendas/termometro-vendas.html')
  );
}

module.exports = {
  abrirPaginaTermometroVendas
};
