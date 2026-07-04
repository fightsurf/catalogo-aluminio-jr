const statusWhatsappService = require('../../services/whatsapp/status-whatsapp.service');

async function verificarConexao(req, res) {
  try {
    const data = await statusWhatsappService.verificarConexao();

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    console.error('Erro ao verificar conexão da Z-API:', error);
    return res.status(502).json({
      success: false,
      message: 'Não foi possível verificar a conexão do WhatsApp.',
      error: error.message,
    });
  }
}

async function publicarImagem(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'Selecione uma imagem para publicar.',
      });
    }

    const imagemBase64 = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;

    const data = await statusWhatsappService.publicarImagem({
      requestId: req.body.requestId,
      imagemBase64,
      legenda: req.body.legenda,
      nomeArquivo: req.file.originalname,
    });

    return res.status(200).json({
      success: true,
      message: data.repetida
        ? 'Publicação já processada anteriormente.'
        : 'Imagem enviada para o Status.',
      data,
    });
  } catch (error) {
    console.error('Erro ao publicar imagem no Status:', error);
    return res.status(502).json({
      success: false,
      message: 'Erro ao publicar a imagem no Status.',
      error: error.message,
    });
  }
}

module.exports = {
  verificarConexao,
  publicarImagem,
};
