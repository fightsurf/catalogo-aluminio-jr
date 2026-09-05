const path = require('path');

function abrirPagina(req, res) {
  return res.sendFile(path.resolve(__dirname, '../../../views/status-videos/status-videos.html'));
}

module.exports = { abrirPagina };
