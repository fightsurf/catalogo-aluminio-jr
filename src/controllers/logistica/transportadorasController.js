const service = require('../../services/logistica/transportadoraService');

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
  } catch (error) {
    res.status(500).json({ error: 'Erro ao criar transportadora' });
  }
}

async function atualizar(req, res) {
  const { id } = req.params;

  try {
    const atualizada = await service.atualizarTransportadora(id, req.body);
    res.json(atualizada);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao atualizar' });
  }
}


async function atualizarTelefonePrincipal(req, res) {
  const { id } = req.params;

  try {
    const atualizada = await service.atualizarTelefonePrincipal(id, req.body?.telefonePrincipal);

    if (!atualizada) {
      return res.status(404).json({ error: 'Transportadora não encontrada' });
    }

    return res.json(atualizada);
  } catch (error) {
    const status = Number(error?.statusCode || 500);
    return res.status(status).json({ error: error.message || 'Erro ao atualizar Telefone Principal' });
  }
}

async function deletar(req, res) {
  const { id } = req.params;

  try {
    await service.deletarTransportadora(id);
    res.json({ sucesso: true });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao deletar' });
  }
}

module.exports = {
  listar,
  criar,
  atualizar,
  atualizarTelefonePrincipal,
  deletar
};
