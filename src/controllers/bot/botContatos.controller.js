const botContatosService = require('../../services/bot/botContatos.services');
const { ValidationError } = botContatosService;

async function listarContatos(req, res) {
  try {
    const contatos = await botContatosService.listarContatos();
    res.json(contatos);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

async function atualizarContato(req, res) {
  try {
    const { id } = req.params;
    const { nome, nivel_atendimento } = req.body;

    const contato = await botContatosService.atualizarContato(id, { nome, nivel_atendimento });

    if (!contato) {
      return res.status(404).json({ success: false, message: 'Contato não encontrado.' });
    }

    res.json({ success: true, contato });
  } catch (error) {
    if (error instanceof ValidationError) {
      return res.status(400).json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: error.message });
  }
}

module.exports = { listarContatos, atualizarContato };
