const semanasService = require('../../../services/legado/semanas/semanas.service');

function responderErro(res, error, fallbackMessage) {
  const status = Number(error?.statusCode || 500);
  return res.status(status).json({
    success: false,
    message: error?.message || fallbackMessage,
    error: error?.message || fallbackMessage
  });
}

async function listarSemanas(req, res) {
  try {
    const data = await semanasService.listarSemanas(req.query || {});
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return responderErro(res, error, 'Erro ao listar semanas.');
  }
}

async function listarCarradasDisponiveis(req, res) {
  try {
    const data = await semanasService.listarCarradasDisponiveis(req.query || {});
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return responderErro(res, error, 'Erro ao listar carradas disponíveis.');
  }
}

async function buscarSemanaPorId(req, res) {
  try {
    const data = await semanasService.buscarSemanaPorId(req.params.id);

    if (!data) {
      return res.status(404).json({ success: false, message: 'Semana não encontrada.' });
    }

    return res.status(200).json({ success: true, data });
  } catch (error) {
    return responderErro(res, error, 'Erro ao buscar semana.');
  }
}

async function buscarResumoSemana(req, res) {
  try {
    const data = await semanasService.buscarResumoSemana(req.params.id);

    if (!data) {
      return res.status(404).json({ success: false, message: 'Semana não encontrada.' });
    }

    return res.status(200).json({ success: true, data });
  } catch (error) {
    return responderErro(res, error, 'Erro ao gerar resumo da semana.');
  }
}

async function criarSemana(req, res) {
  try {
    const data = await semanasService.criarSemana(req.body);
    return res.status(201).json({ success: true, data });
  } catch (error) {
    return responderErro(res, error, 'Erro ao criar semana.');
  }
}

async function atualizarSemana(req, res) {
  try {
    const data = await semanasService.atualizarSemana(req.params.id, req.body);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return responderErro(res, error, 'Erro ao atualizar semana.');
  }
}

async function excluirSemana(req, res) {
  try {
    const data = await semanasService.excluirSemana(req.params.id);

    if (!data) {
      return res.status(404).json({ success: false, message: 'Semana não encontrada.' });
    }

    return res.status(200).json({ success: true, data });
  } catch (error) {
    return responderErro(res, error, 'Erro ao excluir semana.');
  }
}

module.exports = {
  listarSemanas,
  listarCarradasDisponiveis,
  buscarSemanaPorId,
  buscarResumoSemana,
  criarSemana,
  atualizarSemana,
  excluirSemana
};
