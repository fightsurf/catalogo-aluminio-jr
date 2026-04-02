const path = require('path');
const hubService = require('../../services/hub/hub.service');

function abrirPaginaHub(req, res) {
  return res.sendFile(
    path.resolve(__dirname, '../../../views/hub/hub-central.html')
  );
}

function obterConfigHub(req, res) {
  try {
    const config = hubService.getDefaultConfig();
    return res.json({ ok: true, config });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      erro: 'Falha ao carregar configuração do hub.',
      detalhes: error.message
    });
  }
}

module.exports = {
  abrirPaginaHub,
  obterConfigHub
};
