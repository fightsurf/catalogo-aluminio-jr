const path = require('path');

function abrirPaginaPedidosRelatorio(req, res) {
  const caminhoArquivo = path.join(
    process.cwd(),
    'views',
    'legado',
    'pedidos-relatorio',
    'pedidos-relatorio.html'
  );

  return res.sendFile(caminhoArquivo);
}

module.exports = {
  abrirPaginaPedidosRelatorio
};
