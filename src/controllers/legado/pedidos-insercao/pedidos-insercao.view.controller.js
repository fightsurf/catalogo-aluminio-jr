const path = require('path');

function abrirPaginaPedidosInsercao(req, res) {
  const caminhoArquivo = path.join(
    process.cwd(),
    'views',
    'legado',
    'pedidos-insercao',
    'pedidos-insercao.html'
  );

  return res.sendFile(caminhoArquivo);
}

function abrirPaginaRelatorioPedidosInsercao(req, res) {
  const caminhoArquivo = path.join(
    process.cwd(),
    'views',
    'legado',
    'pedidos-insercao',
    'pedidos-insercao-relatorio.html'
  );

  return res.sendFile(caminhoArquivo);
}

module.exports = {
  abrirPaginaPedidosInsercao,
  abrirPaginaRelatorioPedidosInsercao
};
