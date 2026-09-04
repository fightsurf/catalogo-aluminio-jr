const path = require('path');

function abrirPaginaPerformanceExpedicao(req, res) {
  return res.sendFile(
    path.join(__dirname, '../../../views/vendas/performance-expedicao.html')
  );
}

function abrirPaginaExpedidosPendentes(req, res) {
  return res.sendFile(
    path.join(__dirname, '../../../views/vendas/expedidos-pendentes.html')
  );
}

module.exports = {
  abrirPaginaPerformanceExpedicao,
  abrirPaginaExpedidosPendentes
};
