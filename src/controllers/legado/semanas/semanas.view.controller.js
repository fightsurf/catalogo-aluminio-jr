const path = require('path');

function abrirPaginaSemanas(req, res) {
  return res.sendFile(
    path.resolve(__dirname, '../../../../views/legado/semanas/semanas.html')
  );
}

function abrirPaginaDetalheSemana(req, res) {
  return res.sendFile(
    path.resolve(__dirname, '../../../../views/legado/semanas/semanas-detalhe.html')
  );
}

function abrirPaginaResumoSemana(req, res) {
  return res.sendFile(
    path.resolve(__dirname, '../../../../views/legado/semanas/semanas-resumo-itens.html')
  );
}

module.exports = {
  abrirPaginaSemanas,
  abrirPaginaDetalheSemana,
  abrirPaginaResumoSemana
};
