const whatsappService = require('../../services/whatsapp/whatsapp.service');

async function enviar(req, res) {
  try {
    const dado = await whatsappService.enviarMensagem(req.body || {});
    return res.status(200).json({ success: true, data: dado });
  } catch (error) {
    console.error('Erro ao enviar WhatsApp:', error);
    return res.status(500).json({
      success: false,
      error: 'Erro ao enviar mensagem pelo WhatsApp.',
      detalhe: error.message
    });
  }
}

module.exports = {
  enviar
};
