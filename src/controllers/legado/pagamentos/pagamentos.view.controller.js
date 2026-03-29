
const path = require('path');

function abrirPaginaPagamentos(req, res) {
  return res.sendFile(
    path.resolve(__dirname, '../../../../views/legado/pagamentos/pagamentos.html')
  );
}

module.exports = {
  abrirPaginaPagamentos
};
