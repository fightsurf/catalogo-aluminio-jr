
const pagamentosService = require('../../../services/legado/pagamentos/pagamentos.service');
const carradasStatusResumoService = require('../../../services/legado/carradas-progresso/carradas-status-resumo.service');

async function atualizarStatusCarradaSemQuebrar(detalhePedido, fallbackFiltros = {}) {
  let codigoCarrada = detalhePedido?.pedido?.carradaAtual?.codigo ?? null;

  if ((!codigoCarrada || Number(codigoCarrada) <= 0) && fallbackFiltros?.empresa !== undefined && fallbackFiltros?.saida !== undefined) {
    try {
      const detalheAtual = await pagamentosService.buscarPedidoComPagamentos({
        empresa: fallbackFiltros.empresa,
        saida: fallbackFiltros.saida,
        pdv: fallbackFiltros.pdv ?? 0
      });
      codigoCarrada = detalheAtual?.pedido?.carradaAtual?.codigo ?? null;
    } catch (error) {
      codigoCarrada = null;
    }
  }

  const codigo = Number.parseInt(codigoCarrada, 10);

  if (!Number.isInteger(codigo) || codigo <= 0) {
    return;
  }

  try {
    await carradasStatusResumoService.recalcularStatusCarrada(codigo);
  } catch (error) {
    console.error(`Falha ao recalcular status da carrada ${codigo} após alteração de pagamento:`, error.message);
  }
}

async function listarPagamentosRealizados(req, res) {
  try {
    const data = await pagamentosService.listarPagamentosRealizados(req.query);
    return res.status(200).json({ success: true, ...data });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Erro ao listar pagamentos realizados.',
      error: error.message
    });
  }
}

async function listarClientes(req, res) {
  try {
    const data = await pagamentosService.listarClientes(req.query.nome);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Erro ao listar clientes.', error: error.message });
  }
}

async function listarPedidosPorCliente(req, res) {
  try {
    const data = await pagamentosService.listarPedidosPorCliente(req.params.favorecido);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Erro ao listar pedidos por cliente.', error: error.message });
  }
}

async function listarPedidosPorData(req, res) {
  try {
    const data = await pagamentosService.listarPedidosPorData(req.query.data);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Erro ao listar pedidos por data.', error: error.message });
  }
}

async function listarPedidosPorNumero(req, res) {
  try {
    const data = await pagamentosService.listarPedidosPorNumero(req.query.numero);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Erro ao listar pedidos por número.', error: error.message });
  }
}

async function buscarPedidoComPagamentos(req, res) {
  try {
    const data = await pagamentosService.buscarPedidoComPagamentos(req.query);

    if (!data) {
      return res.status(404).json({ success: false, message: 'Pedido não encontrado.' });
    }

    return res.status(200).json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Erro ao buscar pedido.', error: error.message });
  }
}


async function baixarPedidoParaCredito(req, res) {
  try {
    const data = await pagamentosService.baixarPedidoParaCredito(req.body);
    await atualizarStatusCarradaSemQuebrar(data, req.body || {});
    return res.status(201).json({ success: true, data });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: 'Erro ao realizar baixa para crédito.', error: error.message });
  }
}

async function criarPagamento(req, res) {
  try {
    const data = await pagamentosService.criarPagamento(req.body);
    await atualizarStatusCarradaSemQuebrar(data, req.body || {});
    return res.status(201).json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Erro ao criar pagamento.', error: error.message });
  }
}

async function atualizarPagamento(req, res) {
  try {
    const data = await pagamentosService.atualizarPagamento(req.params.codigo, req.body);
    await atualizarStatusCarradaSemQuebrar(data, req.body || {});
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Erro ao atualizar pagamento.', error: error.message });
  }
}

async function excluirPagamento(req, res) {
  try {
    const data = await pagamentosService.excluirPagamento(req.params.codigo, req.query);
    await atualizarStatusCarradaSemQuebrar(data, req.query || {});
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Erro ao excluir pagamento.', error: error.message });
  }
}

module.exports = {
  listarPagamentosRealizados,
  listarClientes,
  listarPedidosPorCliente,
  listarPedidosPorData,
  listarPedidosPorNumero,
  buscarPedidoComPagamentos,
  baixarPedidoParaCredito,
  criarPagamento,
  atualizarPagamento,
  excluirPagamento
};
