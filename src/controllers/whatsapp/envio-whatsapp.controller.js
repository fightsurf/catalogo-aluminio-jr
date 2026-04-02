const envioWhatsappService = require('../../services/whatsapp/envio-whatsapp.service');

async function enviarMensagem(req, res) {
  try {
    const data = await envioWhatsappService.enviarMensagem(req.body || {});

    return res.status(200).json({
      success: true,
      message: 'Mensagem enviada com sucesso.',
      data
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Erro ao enviar mensagem pelo WhatsApp.',
      error: error.message
    });
  }
}

module.exports = {
  enviarMensagem
};
