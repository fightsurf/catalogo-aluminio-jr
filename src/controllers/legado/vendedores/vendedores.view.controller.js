const path = require('path');

function abrirPaginaVendedores(req, res) {
  const caminhoArquivo = path.join(
    process.cwd(),
    'views',
    'legado',
    'vendedores',
    'vendedores.html'
  );

  return res.sendFile(caminhoArquivo);
}

module.exports = {
  abrirPaginaVendedores
};
