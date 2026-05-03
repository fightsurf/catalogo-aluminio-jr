const service = require('../../services/pedidoFornecedor/pedidoFornecedor.service');

async function listarFornecedores(req, res) {
  try {
    const dados = await service.listarFornecedoresComInsumos();
    res.json({ success: true, data: dados });
  } catch (error) {
    console.error('ERRO LISTAR FORNECEDORES PARA PEDIDO:', error);
    res.status(500).json({ success: false, message: error.message });
  }
}

async function listarItensPorFornecedor(req, res) {
  try {
    const dados = await service.listarItensPorFornecedor(req.params.fornecedorId);
    res.json({ success: true, data: dados });
  } catch (error) {
    const status = error.message === 'Fornecedor não encontrado' ? 404 : 400;
    res.status(status).json({ success: false, message: error.message });
  }
}

module.exports = {
  listarFornecedores,
  listarItensPorFornecedor
};
