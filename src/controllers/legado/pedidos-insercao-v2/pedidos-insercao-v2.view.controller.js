const path = require('path');

function abrirPaginaPedidosInsercaoV2(req, res) {
  const caminhoArquivo = path.join(
    process.cwd(),
    'views',
    'legado',
    'pedidos-insercao-v2',
    'pedidos-insercao-v2.html'
  );

  return res.sendFile(caminhoArquivo);
}

module.exports = {
  abrirPaginaPedidosInsercaoV2
};
