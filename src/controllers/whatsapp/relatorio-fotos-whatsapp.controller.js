const relatorioFotosService = require('../../services/whatsapp/relatorio-fotos-whatsapp.service');

async function analisar(req, res) {
  try {
    const data = await relatorioFotosService.analisarRelatorio(req.body || {});

    return res.json({
      success: true,
      data
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message
    });
  }
}

async function enviarItem(req, res) {
  try {
    const data = await relatorioFotosService.enviarItem(req.body || {});

    return res.json({
      success: true,
      message: 'Item enviado com sucesso.',
      data
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message
    });
  }
}

async function finalizar(req, res) {
  try {
    const data = await relatorioFotosService.finalizarEnvio(req.body || {});

    return res.json({
      success: true,
      message: 'Resumo final enviado com sucesso.',
      data
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message
    });
  }
}

module.exports = {
  analisar,
  enviarItem,
  finalizar
};
