const path = require('path');


function abrirPaginaClientesMobile(req, res) {
  const caminhoArquivo = path.join(
    process.cwd(),
    'views',
    'legado',
    'clientes',
    'clientes-mobile.html'
  );

  return res.sendFile(caminhoArquivo);
}

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
  abrirPaginaClientes,
  abrirPaginaClientesMobile
};
