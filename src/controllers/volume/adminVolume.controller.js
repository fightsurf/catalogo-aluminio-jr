const adminVolumeService = require('../../services/volume/adminVolume.Service');

async function listar(req, res) {
  try {
    const { search } = req.query;
    const dados = await adminVolumeService.listar(search);
    res.json({ success: true, data: dados });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

async function atualizarVolume(req, res) {
  try {
    const { id } = req.params;
    const { volume } = req.body;
    const dados = await adminVolumeService.atualizarVolume(id, volume);
    res.json({ success: true, data: dados });
  } catch (error) {
    const status = error.status || 400;
    res.status(status).json({ success: false, message: error.message });
  }
}

module.exports = { listar, atualizarVolume };
