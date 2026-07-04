const path = require('path');

function abrirPaginaStatusWhatsapp(req, res) {
  return res.sendFile(
    path.resolve(__dirname, '../../../views/whatsapp/status-whatsapp.html')
  );
}

module.exports = {
  abrirPaginaStatusWhatsapp,
};
