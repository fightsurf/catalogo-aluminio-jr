
const pagamentosService = require('../../../services/legado/pagamentos/pagamentos.service');

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

async function criarPagamento(req, res) {
  try {
    const data = await pagamentosService.criarPagamento(req.body);
    return res.status(201).json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Erro ao criar pagamento.', error: error.message });
  }
}

async function atualizarPagamento(req, res) {
  try {
    const data = await pagamentosService.atualizarPagamento(req.params.codigo, req.body);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Erro ao atualizar pagamento.', error: error.message });
  }
}

async function excluirPagamento(req, res) {
  try {
    const data = await pagamentosService.excluirPagamento(req.params.codigo, req.query);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Erro ao excluir pagamento.', error: error.message });
  }
}

module.exports = {
  listarClientes,
  listarPedidosPorCliente,
  listarPedidosPorData,
  listarPedidosPorNumero,
  buscarPedidoComPagamentos,
  criarPagamento,
  atualizarPagamento,
  excluirPagamento
};
