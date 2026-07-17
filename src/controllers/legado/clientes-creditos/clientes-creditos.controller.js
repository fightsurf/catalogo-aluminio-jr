const clientesCreditosService = require('../../../services/legado/clientes-creditos/clientes-creditos.service');

async function listarClientes(req, res) {
  try {
    const data = await clientesCreditosService.listarClientes();
    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error('Erro ao listar crédito de clientes:', error);
    return res.status(error.statusCode || 500).json({ success: false, message: 'Erro ao listar crédito de clientes.', error: error.message });
  }
}

async function buscarExtrato(req, res) {
  try {
    const data = await clientesCreditosService.buscarExtrato(req.params.favorecido);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error('Erro ao buscar extrato do cliente:', error);
    return res.status(error.statusCode || 500).json({ success: false, message: 'Erro ao buscar extrato do cliente.', error: error.message });
  }
}


async function registrarAjusteCliente(req, res) {
  try {
    const data = await clientesCreditosService.registrarAjusteCliente(req.params.favorecido, req.body || {});
    return res.status(201).json({ success: true, data });
  } catch (error) {
    console.error('Erro ao registrar ajuste de crédito do cliente:', error);
    return res.status(error.statusCode || 500).json({ success: false, message: 'Erro ao registrar ajuste de crédito do cliente.', error: error.message });
  }
}

async function registrarPagamentoCliente(req, res) {
  try {
    const data = await clientesCreditosService.registrarPagamentoCliente(req.params.favorecido, req.body || {});
    return res.status(201).json({ success: true, data });
  } catch (error) {
    console.error('Erro ao registrar pagamento de crédito do cliente:', error);
    return res.status(error.statusCode || 500).json({ success: false, message: 'Erro ao registrar pagamento de crédito do cliente.', error: error.message });
  }
}

async function atualizarLancamento(req, res) {
  try {
    const data = await clientesCreditosService.atualizarLancamento(
      req.params.favorecido,
      req.params.lancamentoId,
      req.body || {}
    );
    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error('Erro ao atualizar lançamento do extrato do cliente:', error);
    return res.status(error.statusCode || 500).json({ success: false, message: 'Erro ao atualizar lançamento do extrato do cliente.', error: error.message });
  }
}

module.exports = {
  listarClientes,
  buscarExtrato,
  registrarAjusteCliente,
  registrarPagamentoCliente,
  atualizarLancamento
};
