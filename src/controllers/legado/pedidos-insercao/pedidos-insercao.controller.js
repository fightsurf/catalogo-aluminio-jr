const pedidosInsercaoService = require('../../../services/legado/pedidos-insercao/pedidos-insercao.service');

async function inserirPedido(req, res) {
  try {
    const resultado = await pedidosInsercaoService.inserirPedido(req.body);
    return res.status(201).json(resultado);
  } catch (error) {
    console.error('Erro ao inserir pedido via Render:', error);

    return res.status(500).json({
      erro: 'Erro ao inserir pedido do sistema legado.',
      detalhe: error.message
    });
  }
}

module.exports = {
  inserirPedido
};
