const path = require('path');


function abrirPaginaDetalheCarradaMobile(req, res) {
  return res.sendFile(
    path.resolve(__dirname, '../../../../views/legado/carradas/carradas-mobile-detalhe.html')
  );
}

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

function abrirPaginaResumoProducaoCarrada(req, res) {
  return res.sendFile(
    path.resolve(__dirname, '../../../../views/legado/carradas/carradas-resumo-producao.html')
  );
}

function abrirPaginaProgressoCarrada(req, res) {
  return res.sendFile(
    path.resolve(__dirname, '../../../../views/legado/carradas/carradas-progresso.html')
  );
}

module.exports = {
  abrirPaginaCarradas,
  abrirPaginaDetalheCarradaMobile,
  abrirPaginaDetalheCarrada,
  abrirPaginaResumoItensCarrada,
  abrirPaginaResumoProducaoCarrada,
  abrirPaginaProgressoCarrada
};
