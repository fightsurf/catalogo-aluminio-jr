const path = require('path');

function abrirPagina(req, res) {
  return res.sendFile(
    path.resolve(__dirname, '../../../views/whatsapp/relatorios-recebidos.html')
  );
}

module.exports = {
  abrirPagina
};
