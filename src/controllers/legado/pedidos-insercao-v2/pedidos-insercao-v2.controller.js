const pedidosInsercaoV2Service = require('../../../services/legado/pedidos-insercao-v2/pedidos-insercao-v2.service');

async function inserirPedido(req, res) {
  try {
    const resultado = await pedidosInsercaoV2Service.inserirPedido(req.body);
    return res.status(resultado?.salvamentoIncerto ? 202 : 201).json(resultado);
  } catch (error) {
    console.error('Erro ao inserir pedido via Render (V2):', error);

    return res.status(error.isValidation ? 400 : error.pedidoNaoGravado ? 503 : 500).json({
      erro: 'Erro ao inserir pedido do sistema legado.',
      detalhe: error.message,
      ...(error.pedidoNaoGravado ? { pedidoNaoGravado: true } : {})
    });
  }
}

module.exports = {
  inserirPedido
};
