const path = require('path');

function abrirListagem(req, res) {
  return res.sendFile(
    path.resolve(__dirname, '../../../../views/legado/clientes-creditos/clientes-creditos.html')
  );
}

function abrirExtrato(req, res) {
  return res.sendFile(
    path.resolve(__dirname, '../../../../views/legado/clientes-creditos/clientes-creditos-extrato.html')
  );
}

module.exports = {
  abrirListagem,
  abrirExtrato
};
