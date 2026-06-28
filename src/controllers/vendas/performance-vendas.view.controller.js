const path = require('path');

function abrirPaginaPerformanceVendas(req, res) {
  return res.sendFile(
    path.join(__dirname, '../../../views/vendas/performance-vendas.html')
  );
}

module.exports = {
  abrirPaginaPerformanceVendas
};
