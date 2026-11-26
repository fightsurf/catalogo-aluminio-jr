const path = require('path');

function abrirPaginaCheques(req, res) {
  return res.sendFile(
    path.resolve(__dirname, '../../../../views/legado/cheques/cheques.html')
  );
}

function abrirControleCheques(req, res) {
  return res.sendFile(
    path.resolve(__dirname, '../../../../views/legado/cheques/controle-cheques.html')
  );
}

module.exports = {
  abrirPaginaCheques,
  abrirControleCheques
};
