const pedidosClienteService = require('../../../services/legado/pedidos-cliente/pedidos-cliente.service');

async function listarPedidosPorCliente(req, res) {
  try {
    const { favorecido } = req.params;

    if (!favorecido || Number.isNaN(Number(favorecido))) {
      return res.status(400).json({
        sucesso: false,
        mensagem: 'Parâmetro "favorecido" inválido.'
      });
    }

    const resultado = await pedidosClienteService.listarPedidosPorCliente(Number(favorecido));

    return res.json({
      sucesso: true,
      cliente: resultado.cliente,
      total: resultado.dados.length,
      dados: resultado.dados
    });
  } catch (error) {
    return res.status(500).json({
      sucesso: false,
      mensagem: 'Erro ao buscar pedidos do cliente.',
      detalhe: error.message
    });
  }
}


async function enviarResumoImagemWhatsapp(req, res) {
  try {
    const { favorecido } = req.params;

    if (!favorecido || Number.isNaN(Number(favorecido))) {
      return res.status(400).json({
        sucesso: false,
        mensagem: 'Parâmetro "favorecido" inválido.'
      });
    }

    const resultado = await pedidosClienteService.enviarResumoImagemWhatsapp(req.body || {});

    return res.json({
      sucesso: true,
      mensagem: 'Imagem do resumo enviada com sucesso pelo WhatsApp.',
      dados: resultado
    });
  } catch (error) {
    return res.status(500).json({
      sucesso: false,
      mensagem: 'Erro ao enviar imagem do resumo pelo WhatsApp.',
      detalhe: error.message
    });
  }
}

module.exports = {
  listarPedidosPorCliente,
  enviarResumoImagemWhatsapp
};
