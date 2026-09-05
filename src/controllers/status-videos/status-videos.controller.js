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
    const data = await statusVideosService.iniciarPublicacao({
      arquivo: req.file,
      requestId: req.body?.request_id,
      itens: req.body?.itens,
    });

    // O upload HTTP termina aqui. FFmpeg + redes sociais continuam em background e
    // a tela acompanha o andamento pelo endpoint de status. Isso evita 502 por request longa.
    return res.status(202).json({ success: true, data });
  } catch (error) {
    console.error('[Status Vídeos] Erro ao iniciar publicação:', error);
    return res.status(400).json({ success: false, message: error.message || 'Falha ao iniciar a publicação do vídeo.' });
  }
}

async function statusPublicacao(req, res) {
  try {
    const data = statusVideosService.obterPublicacao(req.params.requestId);
    if (!data) {
      return res.status(404).json({
        success: false,
        message: 'Publicação não encontrada. Se o Render reiniciou durante o processamento, envie novamente o vídeo.',
      });
    }
    return res.json({ success: true, data });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message || 'Falha ao consultar a publicação.' });
  }
}

module.exports = {
  diagnostico,
  publicar,
  statusPublicacao,
};
