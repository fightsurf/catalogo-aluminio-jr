const semanasService = require('../../../services/legado/semanas/semanas.service');
const fornecedoresSemanaService = require('../../../services/legado/semanas/semanas-fornecedores.service');

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


async function criarProximaSemana(req, res) {
  try {
    const data = await semanasService.criarProximaSemana();
    return res.status(201).json({ success: true, data });
  } catch (error) {
    return responderErro(res, error, 'Erro ao criar próxima semana.');
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

async function enviarWhatsappSemanaLote(req, res) {
  try {
    const data = await semanasService.enviarWhatsappSemanaLote({
      semanaId: req.params.id,
      mensagemPersonalizada: req.body?.mensagemPersonalizada
    });

    return res.status(200).json({ success: true, data });
  } catch (error) {
    return responderErro(res, error, 'Erro ao enviar WhatsApp da semana.');
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


async function listarFornecedoresResumo(req, res) {
  try {
    const data = await fornecedoresSemanaService.montarResumoAssociado(req.params.id);
    res.json({ success: true, data });
  } catch (error) {
    return responderErro(res, error, 'Falha ao consultar fornecedores da semana.');
  }
}
async function salvarFornecedoresResumo(req, res) {
  try {
    const data = await fornecedoresSemanaService.salvarAssociacoes(req.params.id, req.body || {});
    res.json({ success: true, data });
  } catch (error) {
    return responderErro(res, error, 'Falha ao salvar associação.');
  }
}
async function visualizarWhatsappFornecedor(req, res) {
  try {
    const data = await fornecedoresSemanaService.prepararEnvio(req.params.id, Number(req.params.fornecedorId));
    res.json({ success: true, data: { mensagem: data.mensagem, telefone: data.telefone, fornecedor: data.fornecedor.nome, quantidade_itens: data.itens, conteudo_hash: data.conteudo_hash } });
  } catch (error) {
    return responderErro(res, error, 'Falha ao montar mensagem.');
  }
}
async function enviarWhatsappFornecedor(req, res) {
  try {
    const data = await fornecedoresSemanaService.enviar(Number(req.params.id), Number(req.params.fornecedorId), req.body?.conteudo_hash);
    res.json({ success: true, data });
  } catch (error) {
    return responderErro(res, error, 'Falha ao enviar mensagem.');
  }
}

module.exports = {
  listarFornecedoresResumo,
  salvarFornecedoresResumo,
  visualizarWhatsappFornecedor,
  enviarWhatsappFornecedor,
  listarSemanas,
  listarCarradasDisponiveis,
  buscarSemanaPorId,
  buscarResumoSemana,
  criarSemana,
  criarProximaSemana,
  atualizarSemana,
  enviarWhatsappSemanaLote,
  excluirSemana
};
