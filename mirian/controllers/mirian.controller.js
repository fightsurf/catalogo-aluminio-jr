const mirianService = require('../services/mirian.service');

function responderErro(res, error) {
  const status = Number(error.status) || 500;

  if (status >= 500) {
    console.error('[mirian]', error);
  }

  return res.status(status).json({
    erro: status >= 500 ? 'Não foi possível concluir a operação.' : error.message,
  });
}

async function listarSintomas(req, res) {
  try {
    const incluirInativos =
      req.query.incluirInativos === '1' ||
      req.query.incluirInativos === 'true';

    const sintomas = await mirianService.listarSintomas({ incluirInativos });
    return res.json(sintomas);
  } catch (error) {
    return responderErro(res, error);
  }
}

async function criarSintoma(req, res) {
  try {
    const sintoma = await mirianService.criarSintoma(req.body || {});
    return res.status(201).json(sintoma);
  } catch (error) {
    return responderErro(res, error);
  }
}

async function atualizarSintoma(req, res) {
  try {
    const sintoma = await mirianService.atualizarSintoma(
      req.params.id,
      req.body || {}
    );

    return res.json(sintoma);
  } catch (error) {
    return responderErro(res, error);
  }
}

async function excluirSintoma(req, res) {
  try {
    const sintoma = await mirianService.excluirSintoma(req.params.id);
    return res.json({
      ok: true,
      sintoma,
    });
  } catch (error) {
    return responderErro(res, error);
  }
}

async function criarPaciente(req, res) {
  try {
    const paciente = await mirianService.criarPaciente(req.body || {});
    return res.status(201).json({
      ok: true,
      mensagem: 'Cadastro enviado com sucesso.',
      paciente,
    });
  } catch (error) {
    return responderErro(res, error);
  }
}

async function listarPacientes(req, res) {
  try {
    const pacientes = await mirianService.listarPacientes({
      nome: req.query.nome,
      telefone: req.query.telefone,
      cidade: req.query.cidade,
      sintomaId: req.query.sintomaId,
    });

    return res.json(pacientes);
  } catch (error) {
    return responderErro(res, error);
  }
}

async function atualizarPacienteVisitado(req, res) {
  try {
    const paciente = await mirianService.atualizarPacienteVisitado(
      req.params.id,
      req.body ? req.body.visitado : undefined
    );

    return res.json({
      ok: true,
      paciente,
    });
  } catch (error) {
    return responderErro(res, error);
  }
}

module.exports = {
  listarSintomas,
  criarSintoma,
  atualizarSintoma,
  excluirSintoma,
  criarPaciente,
  listarPacientes,
  atualizarPacienteVisitado,
};
