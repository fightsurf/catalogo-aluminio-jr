const path = require('path');

function abrirPaginaClientes(req, res) {
  const caminhoArquivo = path.join(
    process.cwd(),
    'views',
    'legado',
    'clientes',
    'clientes.html'
  );

  return res.sendFile(caminhoArquivo);
}

module.exports = {
  abrirPaginaClientes
};
