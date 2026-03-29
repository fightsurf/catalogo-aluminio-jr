const path = require('path');

function abrirPaginaCarradas(req, res) {
  return res.sendFile(
    path.resolve(__dirname, '../../../../views/legado/carradas/carradas.html')
  );
}

function abrirPaginaDetalheCarrada(req, res) {
  return res.sendFile(
    path.resolve(__dirname, '../../../../views/legado/carradas/carradas-detalhe.html')
  );
}

module.exports = {
  abrirPaginaCarradas,
  abrirPaginaDetalheCarrada
};
