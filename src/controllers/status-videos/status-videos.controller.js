const statusVideosService = require('../../services/status-videos/status-videos.service');

async function diagnostico(req, res) {
  try {
    return res.json({ success: true, data: statusVideosService.diagnostico() });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
}

async function publicar(req, res) {
  try {
    const data = await statusVideosService.publicar({
      arquivo: req.file,
      requestId: req.body?.request_id,
      itens: req.body?.itens,
    });
    return res.status(data.status_geral === 'erro' ? 502 : 200).json({ success: data.success, data });
  } catch (error) {
    console.error('[Status Vídeos] Erro na publicação:', error);
    return res.status(400).json({ success: false, message: error.message || 'Falha ao publicar o vídeo.' });
  }
}

module.exports = {
  diagnostico,
  publicar,
};
