const path = require('path');

function abrirPaginaCheques(req, res) {
  return res.sendFile(
    path.resolve(__dirname, '../../../../views/legado/cheques/cheques.html')
  );
}

module.exports = {
  abrirPaginaCheques
};
