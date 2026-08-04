const path = require('path');

function abrirPagina(req, res) {
  return res.sendFile(
    path.resolve(__dirname, '../../../views/whatsapp/relatorio-fotos-whatsapp.html')
  );
}

module.exports = {
  abrirPagina
};
