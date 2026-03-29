const carradasService = require('../../../services/legado/carradas/carradas.service');

async function listarClientes(req, res) {
  try {
    const data = await carradasService.listarClientes(req.query.nome);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Erro ao listar clientes.', error: error.message });
  }
}

async function listarPedidosPorCliente(req, res) {
  try {
    const data = await carradasService.listarPedidosPorCliente(req.params.favorecido);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Erro ao listar pedidos por cliente.', error: error.message });
  }
}

async function listarPedidosPorData(req, res) {
  try {
    const data = await carradasService.listarPedidosPorData(req.query.data);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Erro ao listar pedidos por data.', error: error.message });
  }
}

async function listarPedidosPorNumero(req, res) {
  try {
    const data = await carradasService.listarPedidosPorNumero(req.query.numero);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Erro ao listar pedidos por número.', error: error.message });
  }
}

async function listarCarradas(req, res) {
  try {
    const data = await carradasService.listarCarradas();
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Erro ao listar carradas.', error: error.message });
  }
}

async function buscarCarrada(req, res) {
  try {
    const data = await carradasService.buscarCarrada(req.params.codigo);

    if (!data) {
      return res.status(404).json({ success: false, message: 'Carrada não encontrada.' });
    }

    return res.status(200).json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Erro ao buscar carrada.', error: error.message });
  }
}

async function criarCarrada(req, res) {
  try {
    const data = await carradasService.criarCarrada(req.body);
    return res.status(201).json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Erro ao criar carrada.', error: error.message });
  }
}

async function atualizarCarrada(req, res) {
  try {
    const data = await carradasService.atualizarCarrada(req.params.codigo, req.body);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Erro ao atualizar carrada.', error: error.message });
  }
}

async function excluirCarrada(req, res) {
  try {
    const data = await carradasService.excluirCarrada(req.params.codigo);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Erro ao excluir carrada.', error: error.message });
  }
}

module.exports = {
  listarClientes,
  listarPedidosPorCliente,
  listarPedidosPorData,
  listarPedidosPorNumero,
  listarCarradas,
  buscarCarrada,
  criarCarrada,
  atualizarCarrada,
  excluirCarrada
};
