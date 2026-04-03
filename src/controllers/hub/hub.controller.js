const path = require('path');
const hubService = require('../../services/hub/hub.service');

async function abrirPaginaHub(req, res) {
  return res.sendFile(
    path.resolve(__dirname, '../../../views/hub/hub-central.html')
  );
}

async function obterConfig(req, res) {
  try {
    const config = await hubService.loadConfig();
    return res.json({
      ok: true,
      config
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      erro: 'Falha ao carregar a configuração do hub.',
      detalhe: error.message
    });
  }
}

async function salvarConfig(req, res) {
  try {
    const config = await hubService.saveConfig(req.body || {});
    return res.json({
      ok: true,
      mensagem: 'Configuração do hub salva com sucesso.',
      config
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      erro: 'Falha ao salvar a configuração do hub.',
      detalhe: error.message
    });
  }
}

module.exports = {
  abrirPaginaHub,
  obterConfig,
  salvarConfig
};
