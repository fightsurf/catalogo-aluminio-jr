const path = require('path');

function abrirPaginaPerformanceExpedicao(req, res) {
  return res.sendFile(
    path.join(__dirname, '../../../views/vendas/performance-expedicao.html')
  );
}

module.exports = {
  abrirPaginaPerformanceExpedicao
};
