const clientesCreditosService = require('../../../services/legado/clientes-creditos/clientes-creditos.service');
const whatsappExtratoService = require('../../../services/legado/clientes-creditos/clientes-creditos-whatsapp.service');

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

async function registrarDividaAvulsa(req, res) {
  try {
    const data = await clientesCreditosService.registrarDividaAvulsa(req.params.favorecido, req.body || {});
    return res.status(201).json({ success: true, data });
  } catch (error) {
    console.error('Erro ao registrar dívida avulsa do cliente:', error);
    return res.status(error.statusCode || 500).json({ success: false, message: 'Erro ao registrar dívida avulsa do cliente.', error: error.message });
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


async function prepararWhatsappExtrato(req, res) {
  try {
    const data = await whatsappExtratoService.preparar(req.params.favorecido);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error('Erro ao preparar WhatsApp do extrato:', error);
    return res.status(error.statusCode || error.status || 500).json({
      success: false, message: error.message || 'Falha ao preparar WhatsApp.'
    });
  }
}

async function enviarWhatsappExtrato(req, res) {
  try {
    const data = await whatsappExtratoService.enviar(req.params.favorecido, req.body?.confirmacao);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error('Erro ao enviar WhatsApp do extrato:', error);
    return res.status(error.statusCode || error.status || 500).json({
      success: false, message: error.message || 'Falha no envio WhatsApp. Verifique antes de reenviar.'
    });
  }
}

module.exports = {
  listarClientes,
  buscarExtrato,
  prepararWhatsappExtrato,
  enviarWhatsappExtrato,
  registrarAjusteCliente,
  registrarDividaAvulsa,
  registrarPagamentoCliente,
  atualizarLancamento
};
