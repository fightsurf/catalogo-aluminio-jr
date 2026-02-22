const service = require('../services/transportadoraService');

async function listar(req, res) {
  try {
    const dados = await service.listarTransportadoras();
    res.json(dados);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao buscar transportadoras' });
  }
}

async function criar(req, res) {
  const { nome } = req.body;

  if (!nome) {
    return res.status(400).json({ error: 'Nome é obrigatório' });
  }

  try {
    const nova = await service.criarTransportadora(req.body);
    res.status(201).json(nova);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao criar transportadora' });
  }
}

module.exports = {
  listar,
  criar
};
