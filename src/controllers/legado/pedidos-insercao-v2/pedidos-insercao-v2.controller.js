const pedidosInsercaoV2Service = require('../../../services/legado/pedidos-insercao-v2/pedidos-insercao-v2.service');

async function inserirPedido(req, res) {
  try {
    const resultado = await pedidosInsercaoV2Service.inserirPedido(req.body);
    return res.status(201).json(resultado);
  } catch (error) {
    console.error('Erro ao inserir pedido via Render (V2):', error);

    return res.status(500).json({
      erro: 'Erro ao inserir pedido do sistema legado (V2).',
      detalhe: error.message
    });
  }
}

module.exports = {
  inserirPedido
};
