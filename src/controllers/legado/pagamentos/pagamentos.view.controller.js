
const path = require('path');

function abrirPaginaPagamentos(req, res) {
  return res.sendFile(
    path.resolve(__dirname, '../../../../views/legado/pagamentos/pagamentos.html')
  );
}

function abrirPaginaPagamentosMobile(req, res) {
  return res.sendFile(
    path.resolve(__dirname, '../../../../views/legado/pagamentos/pagamentos-mobile.html')
  );
}

module.exports = {
  abrirPaginaPagamentos,
  abrirPaginaPagamentosMobile
};
