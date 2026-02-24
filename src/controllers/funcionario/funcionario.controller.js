const service = require('../../services/funcionario/funcionario.service');

async function listar(req, res) {
  try {
    const { nome, ativo } = req.query;
    const data = await service.listar(nome, ativo);
    return res.json(data);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

async function buscarPorId(req, res) {
  try {
    const { id } = req.params;
    const data = await service.buscarPorId(id);
    if (!data) {
      return res.status(404).json({ error: 'Funcionário não encontrado' });
    }
    return res.json(data);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

async function criar(req, res) {
  try {
    const { nome, telefone, data_nascimento } = req.body;

    if (!nome || !telefone || !data_nascimento) {
      return res.status(400).json({ error: 'Nome, telefone e data de nascimento são obrigatórios' });
    }

    const data = await service.criar(nome, telefone, data_nascimento);
    return res.status(201).json(data);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

async function atualizar(req, res) {
  try {
    const { id } = req.params;
    const { nome, telefone, data_nascimento } = req.body;

    const data = await service.atualizar(id, nome, telefone, data_nascimento);

    if (!data) {
      return res.status(404).json({ error: 'Funcionário não encontrado' });
    }

    return res.json(data);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

async function remover(req, res) {
  try {
    const { id } = req.params;
    await service.remover(id);
    return res.json({ message: 'Funcionário desativado com sucesso' });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

module.exports = {
  listar,
  buscarPorId,
  criar,
  atualizar,
  remover
};
