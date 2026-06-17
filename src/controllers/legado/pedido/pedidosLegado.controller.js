const pedidosLegadoService = require('../../../services/legado/pedido/pedidosLegado.service');

function textoOuVazio(valor) {
  return String(valor || '').trim();
}

async function pesquisarPedidos(req, res) {
  try {
    const numero = textoOuVazio(req.query.numero);
    const cliente = textoOuVazio(req.query.cliente);
    const data = textoOuVazio(req.query.data);

    if (!numero && !cliente && !data) {
      return res.status(400).json({
        success: false,
        message: 'Informe pelo menos um filtro: número, cliente ou data.'
      });
    }

    const pedidos = await pedidosLegadoService.pesquisarPedidos({
      numero,
      cliente,
      data
    });

    return res.json({
      success: true,
      data: pedidos
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Erro ao pesquisar pedidos do legado.',
      error: error.message
    });
  }
}

async function buscarItensPedido(req, res) {
  try {
    const { idMestre } = req.params;

    if (!idMestre) {
      return res.status(400).json({
        success: false,
        message: 'Informe o id do pedido.'
      });
    }

    const pedido = await pedidosLegadoService.buscarItensPedido(idMestre);

    if (!pedido) {
      return res.status(404).json({
        success: false,
        message: 'Pedido não encontrado.'
      });
    }

    return res.json({
      success: true,
      data: pedido
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Erro ao buscar itens do pedido do legado.',
      error: error.message
    });
  }
}


async function listarCarradasDisponiveis(req, res) {
  try {
    const { idMestre } = req.params;

    if (!idMestre) {
      return res.status(400).json({
        success: false,
        message: 'Informe o id do pedido.'
      });
    }

    const data = await pedidosLegadoService.listarCarradasDisponiveis(idMestre);

    return res.json({
      success: true,
      data
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Erro ao listar carradas disponíveis do pedido.',
      error: error.message
    });
  }
}

async function alterarCarradaPedido(req, res) {
  try {
    const { idMestre } = req.params;

    if (!idMestre) {
      return res.status(400).json({
        success: false,
        message: 'Informe o id do pedido.'
      });
    }

    const data = await pedidosLegadoService.alterarCarradaPedido(
      idMestre,
      req.body?.codigoCarrada ?? null
    );

    return res.json({
      success: true,
      message: 'Carrada do pedido atualizada com sucesso.',
      data
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message || 'Erro ao alterar carrada do pedido.',
      error: error.message
    });
  }
}

async function atualizarPedido(req, res) {
  try {
    const { idMestre } = req.params;

    if (!idMestre) {
      return res.status(400).json({
        success: false,
        message: 'Informe o id do pedido.'
      });
    }

    const pedido = await pedidosLegadoService.atualizarPedido(idMestre, req.body || {});

    return res.json({
      success: true,
      message: 'Pedido atualizado com sucesso.',
      data: pedido
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message || 'Erro ao atualizar pedido do legado.',
      error: error.message
    });
  }
}
async function enviarPdfWhatsappPedido(req, res) {
  try {
    const { idMestre } = req.params;

    if (!idMestre) {
      return res.status(400).json({
        success: false,
        message: 'Informe o id do pedido.'
      });
    }

    const data = await pedidosLegadoService.enviarPdfWhatsappPedido(idMestre);

    return res.json({
      success: true,
      message: 'PDF do pedido enviado com sucesso pelo WhatsApp.',
      data
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message || 'Erro ao enviar PDF do pedido pelo WhatsApp.',
      error: error.message
    });
  }
}

module.exports = {
  pesquisarPedidos,
  buscarItensPedido,
  listarCarradasDisponiveis,
  alterarCarradaPedido,
  atualizarPedido,
  enviarPdfWhatsappPedido
};
