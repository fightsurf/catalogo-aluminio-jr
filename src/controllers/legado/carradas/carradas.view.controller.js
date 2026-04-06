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

function abrirPaginaResumoItensCarrada(req, res) {
  return res.sendFile(
    path.resolve(__dirname, '../../../../views/legado/carradas/carradas-resumo-itens.html')
  );
}

function abrirPaginaProgressoCarrada(req, res) {
  return res.sendFile(
    path.resolve(__dirname, '../../../../views/legado/carradas/carradas-progresso.html')
  );
}

module.exports = {
  abrirPaginaCarradas,
  abrirPaginaDetalheCarrada,
  abrirPaginaResumoItensCarrada,
  abrirPaginaProgressoCarrada
};
