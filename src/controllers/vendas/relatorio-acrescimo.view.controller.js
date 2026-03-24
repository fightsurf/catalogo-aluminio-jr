const path = require('path');

function abrirPaginaRelatorioAcrescimo(req, res) {
  return res.sendFile(
    path.join(__dirname, '../../../views/vendas/relatorio-acrescimo.html')
  );
}

module.exports = {
  abrirPaginaRelatorioAcrescimo
};
