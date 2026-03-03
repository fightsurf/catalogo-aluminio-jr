const botIntencoesService = require('../../services/bot/botIntencoes.services');
const { ValidationError, DuplicateError } = botIntencoesService;

async function listarTodas(req, res) {
  try {
    const intencoes = await botIntencoesService.listarTodas();
    res.json(intencoes);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

async function criar(req, res) {
  try {
    const intencao = await botIntencoesService.criar(req.body);
    res.status(201).json({ success: true, intencao });
  } catch (error) {
    if (error instanceof ValidationError) {
      return res.status(400).json({ success: false, message: error.message });
    }
    if (error instanceof DuplicateError) {
      return res.status(409).json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: error.message });
  }
}

async function atualizar(req, res) {
  try {
    const { id } = req.params;
    const intencao = await botIntencoesService.atualizar(id, req.body);
    if (!intencao) {
      return res.status(404).json({ success: false, message: 'Intenção não encontrada.' });
    }
    res.json({ success: true, intencao });
  } catch (error) {
    if (error instanceof ValidationError) {
      return res.status(400).json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: error.message });
  }
}

async function listarAtivas(req, res) {
  try {
    const intencoes = await botIntencoesService.listarAtivas();
    res.json(intencoes);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

module.exports = { listarTodas, criar, atualizar, listarAtivas };
