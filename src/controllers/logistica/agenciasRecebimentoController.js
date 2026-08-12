const service = require('../../services/logistica/agenciaRecebimentoService');

function responderErro(res, error, fallback) {
  const status = Number(error?.statusCode || 500);
  return res.status(status).json({ error: error?.message || fallback });
}

async function listar(req, res) {
  try {
    return res.json(await service.listarAgencias());
  } catch (error) {
    return responderErro(res, error, 'Erro ao buscar Agências de Recebimento.');
  }
}

async function buscar(req, res) {
  try {
    const agencia = await service.buscarAgenciaPorCodigo(req.params.codigo);
    if (!agencia) {
      return res.status(404).json({ error: 'Agência de Recebimento não encontrada.' });
    }
    return res.json(agencia);
  } catch (error) {
    return responderErro(res, error, 'Erro ao buscar Agência de Recebimento.');
  }
}

async function criar(req, res) {
  try {
    const agencia = await service.criarAgencia(req.body || {});
    return res.status(201).json(agencia);
  } catch (error) {
    return responderErro(res, error, 'Erro ao criar Agência de Recebimento.');
  }
}

async function atualizar(req, res) {
  try {
    const agencia = await service.atualizarAgencia(req.params.codigo, req.body || {});
    return res.json(agencia);
  } catch (error) {
    return responderErro(res, error, 'Erro ao atualizar Agência de Recebimento.');
  }
}

async function deletar(req, res) {
  try {
    await service.deletarAgencia(req.params.codigo);
    return res.json({ sucesso: true });
  } catch (error) {
    return responderErro(res, error, 'Erro ao excluir Agência de Recebimento.');
  }
}

module.exports = { listar, buscar, criar, atualizar, deletar };
