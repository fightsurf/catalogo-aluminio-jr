const path = require('path');

function abrirPaginaEnvioWhatsapp(req, res) {
  return res.sendFile(
    path.resolve(__dirname, '../../../views/whatsapp/envio-whatsapp.html')
  );
}

module.exports = {
  abrirPaginaEnvioWhatsapp
};
