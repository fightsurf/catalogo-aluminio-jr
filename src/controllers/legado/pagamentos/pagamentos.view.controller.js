
const path = require('path');

function abrirPaginaPagamentos(req, res) {
  return res.sendFile(
    path.resolve(__dirname, '../../../../views/legado/pagamentos/pagamentos.html')
  );
}

function abrirPaginaDistribuirPagamento(req, res) {
  return res.sendFile(
    path.resolve(__dirname, '../../../../views/legado/pagamentos/pagamentos-distribuir.html')
  );
}

function abrirPaginaPagamentosRealizados(req, res) {
  return res.sendFile(
    path.resolve(__dirname, '../../../../views/legado/pagamentos/pagamentos-realizados.html')
  );
}

function abrirPaginaPagamentosMobile(req, res) {
  return res.sendFile(
    path.resolve(__dirname, '../../../../views/legado/pagamentos/pagamentos-mobile.html')
  );
}

module.exports = {
  abrirPaginaPagamentos,
  abrirPaginaDistribuirPagamento,
  abrirPaginaPagamentosRealizados,
  abrirPaginaPagamentosMobile
};
