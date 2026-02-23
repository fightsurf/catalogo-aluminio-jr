const service = require('../services/transportadoraService');

async function listar(req, res) {
  try {
    const dados = await service.listarTransportadoras();
    res.json(dados);
  } catch (error) {
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
  } catch {
    res.status(500).json({ error: 'Erro ao criar transportadora' });
  }
}

async function atualizar(req, res) {
  const { id } = req.params;
  const { nome, telefone } = req.body;

  try {
    const atualizada = await service.atualizarTransportadora(id, { nome, telefone });
    res.json(atualizada);
  } catch {
    res.status(500).json({ error: 'Erro ao atualizar' });
  }
}

async function deletar(req, res) {
  const { id } = req.params;

  try {
    await service.deletarTransportadora(id);
    res.json({ sucesso: true });
  } catch {
    res.status(500).json({ error: 'Erro ao deletar' });
  }
}

module.exports = {
  listar,
  criar,
  atualizar,
  deletar
};
