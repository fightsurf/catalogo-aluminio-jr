const pedidosLegadoService = require('../../../services/legado/pedido/pedidosLegado.service');

async function pesquisarPedidos(req, res) {
  try {
    const { numero } = req.query;

    if (!numero || !String(numero).trim()) {
      return res.status(400).json({
        success: false,
        message: 'Informe o número do pedido.'
      });
    }

    const pedidos = await pedidosLegadoService.pesquisarPedidos(numero);

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

module.exports = {
  pesquisarPedidos,
  buscarItensPedido
};
