const service = require('../../../services/legado/carradas-progresso/carradas-progresso.service');

function responderErro(res, error, fallbackMessage) {
  const status = Number(error?.statusCode || 500);
  return res.status(status).json({
    success: false,
    message: error?.message || fallbackMessage,
    error: error?.message || fallbackMessage
  });
}


async function buscarResumoListaCarradas(req, res) {
  try {
    const codigos = String(req.query?.codigos || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);

    const data = await service.buscarResumoListaCarradas(codigos);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return responderErro(res, error, 'Erro ao carregar o resumo das carradas.');
  }
}

async function buscarMatriz(req, res) {
  try {
    const data = await service.buscarMatriz(req.params.codigo);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return responderErro(res, error, 'Erro ao carregar o progresso da carrada.');
  }
}

async function calcularQuantidadeVolumesPedido(req, res) {
  try {
    const data = await service.calcularQuantidadeVolumesPedido({
      codigoCarrada: req.params.codigo,
      numeroPedido: req.params.numeroPedido
    });

    return res.status(200).json({ success: true, data });
  } catch (error) {
    return responderErro(res, error, 'Erro ao calcular a quantidade de volumes.');
  }
}

async function salvarQuantidadeVolumesManual(req, res) {
  try {
    const data = await service.salvarQuantidadeVolumesManual({
      codigoCarrada: req.params.codigo,
      numeroPedido: req.params.numeroPedido,
      quantidade: req.body?.quantidade
    });

    return res.status(200).json({ success: true, data });
  } catch (error) {
    return responderErro(res, error, 'Erro ao salvar a quantidade de volumes.');
  }
}

async function salvarDataExpedicao(req, res) {
  try {
    const data = await service.salvarDataExpedicao({
      codigoCarrada: req.params.codigo,
      numeroPedido: req.params.numeroPedido,
      dataExpedicao: req.body?.dataExpedicao
    });

    return res.status(200).json({ success: true, data });
  } catch (error) {
    return responderErro(res, error, 'Erro ao salvar a data de expedição.');
  }
}

async function salvarFaseBooleana(req, res) {
  try {
    const data = await service.salvarFaseBooleana({
      codigoCarrada: req.params.codigo,
      numeroPedido: req.params.numeroPedido,
      faseCodigo: req.params.faseCodigo,
      valor: req.body?.valor,
      silencioso: req.body?.silencioso === true || req.body?.silencioso === 'true'
    });

    return res.status(200).json({ success: true, data });
  } catch (error) {
    return responderErro(res, error, 'Erro ao salvar a fase booleana.');
  }
}

async function buscarDadosEtiquetaImpressao(req, res) {
  try {
    const data = await service.buscarDadosEtiquetaImpressao({
      codigoCarrada: req.params.codigo,
      numeroPedido: req.params.numeroPedido
    });

    return res.status(200).json({ success: true, data });
  } catch (error) {
    return responderErro(res, error, 'Erro ao montar a etiqueta de impressão.');
  }
}

async function enviarEtiquetaImpressaoWhatsapp(req, res) {
  try {
    const data = await service.enviarEtiquetaImpressaoWhatsapp({
      codigoCarrada: req.params.codigo,
      numeroPedido: req.params.numeroPedido
    });

    return res.status(200).json({ success: true, data });
  } catch (error) {
    return responderErro(res, error, 'Erro ao enviar a imagem da etiqueta pelo WhatsApp.');
  }
}

async function buscarDadosEtiquetaPedido(req, res) {
  try {
    const data = await service.buscarDadosEtiquetaPedido({
      codigoCarrada: req.params.codigo,
      numeroPedido: req.params.numeroPedido
    });

    return res.status(200).json({ success: true, data });
  } catch (error) {
    return responderErro(res, error, 'Erro ao carregar os dados da etiqueta de volumes.');
  }
}

async function salvarPerfilEtiquetaPedido(req, res) {
  try {
    const data = await service.salvarPerfilEtiquetaPedido({
      codigoCarrada: req.params.codigo,
      numeroPedido: req.params.numeroPedido,
      etiquetaClienteId: req.body?.etiquetaClienteId,
      apelido: req.body?.apelido,
      textoEtiqueta: req.body?.textoEtiqueta,
      nomeImpressao: req.body?.nomeImpressao,
      telefoneImpressao: req.body?.telefoneImpressao,
      cidadeImpressao: req.body?.cidadeImpressao,
      ufImpressao: req.body?.ufImpressao
    });
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return responderErro(res, error, 'Erro ao salvar o perfil da etiqueta.');
  }
}

async function enviarEtiquetaVolumes(req, res) {
  try {
    const data = await service.enviarEtiquetaVolumes({
      codigoCarrada: req.params.codigo,
      numeroPedido: req.params.numeroPedido,
      etiquetaClienteId: req.body?.etiquetaClienteId,
      apelido: req.body?.apelido,
      textoEtiqueta: req.body?.textoEtiqueta
    });

    return res.status(200).json({ success: true, data });
  } catch (error) {
    return responderErro(res, error, 'Erro ao enviar a etiqueta de volumes.');
  }
}

async function confirmarEtiquetaVolumes(req, res) {
  try {
    const data = await service.confirmarEtiquetaVolumes({
      codigoCarrada: req.params.codigo,
      numeroPedido: req.params.numeroPedido,
      confirmado: req.body?.confirmado
    });

    return res.status(200).json({ success: true, data });
  } catch (error) {
    return responderErro(res, error, 'Erro ao confirmar a etiqueta de volumes.');
  }
}

async function salvarLocalEntrega(req, res) {
  try {
    const data = await service.salvarLocalEntrega({
      codigoCarrada: req.params.codigo,
      numeroPedido: req.params.numeroPedido,
      transportadoraId: req.body?.transportadoraId,
      redespachoTransportadoraId: req.body?.redespachoTransportadoraId,
      agenciaRecebimentoCodigo: req.body?.agenciaRecebimentoCodigo
    });

    return res.status(200).json({ success: true, data });
  } catch (error) {
    return responderErro(res, error, 'Erro ao salvar o local de entrega.');
  }
}

async function buscarHistoricoLocalEntrega(req, res) {
  try {
    const data = await service.buscarHistoricoLocalEntrega({
      codigoCarrada: req.params.codigo,
      numeroPedido: req.params.numeroPedido
    });

    return res.status(200).json({ success: true, data });
  } catch (error) {
    return responderErro(res, error, 'Erro ao buscar o histórico de locais de entrega.');
  }
}

async function perguntarRepeticaoLocalEntrega(req, res) {
  try {
    const data = await service.perguntarRepeticaoLocalEntrega({
      codigoCarrada: req.params.codigo,
      numeroPedido: req.params.numeroPedido
    });

    return res.status(200).json({ success: true, data });
  } catch (error) {
    return responderErro(res, error, 'Erro ao perguntar o local de entrega ao cliente.');
  }
}

async function enviarWhatsappCarradaLote(req, res) {
  try {
    const data = await service.enviarWhatsappCarradaLote({
      codigoCarrada: req.params.codigo,
      mensagemPersonalizada: req.body?.mensagemPersonalizada
    });

    return res.status(200).json({ success: true, data });
  } catch (error) {
    return responderErro(res, error, 'Erro ao enviar WhatsApp da carrada.');
  }
}

module.exports = {
  buscarResumoListaCarradas,
  buscarMatriz,
  calcularQuantidadeVolumesPedido,
  salvarQuantidadeVolumesManual,
  salvarDataExpedicao,
  salvarFaseBooleana,
  buscarDadosEtiquetaPedido,
  buscarDadosEtiquetaImpressao,
  enviarEtiquetaImpressaoWhatsapp,
  salvarPerfilEtiquetaPedido,
  enviarEtiquetaVolumes,
  confirmarEtiquetaVolumes,
  salvarLocalEntrega,
  buscarHistoricoLocalEntrega,
  perguntarRepeticaoLocalEntrega,
  enviarWhatsappCarradaLote
};
