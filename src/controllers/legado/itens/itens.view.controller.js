const path = require('path');

function abrirPaginaItens(req, res) {
  const caminhoArquivo = path.join(
    process.cwd(),
    'views',
    'legado',
    'itens',
    'itens.html'
  );

  return res.sendFile(caminhoArquivo);
}

module.exports = {
  abrirPaginaItens
};
