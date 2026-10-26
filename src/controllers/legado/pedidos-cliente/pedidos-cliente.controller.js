const pedidosClienteService = require('../../../services/legado/pedidos-cliente/pedidos-cliente.service');
const precosHistoricosService = require('../../../services/legado/pedidos-cliente/precosHistoricos.service');

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


async function buscarPerfilCompras(req, res) {
  try {
    const { favorecido } = req.params;

    if (!favorecido || Number.isNaN(Number(favorecido))) {
      return res.status(400).json({
        sucesso: false,
        mensagem: 'Parâmetro "favorecido" inválido.'
      });
    }

    const dados = await pedidosClienteService.buscarPerfilCompras(Number(favorecido));

    return res.json({
      sucesso: true,
      dados
    });
  } catch (error) {
    return res.status(500).json({
      sucesso: false,
      mensagem: 'Erro ao carregar o perfil de compras do cliente.',
      detalhe: error.message
    });
  }
}


async function buscarPrecosHistoricos(req, res) {
  try {
    const favorecido = Number(req.params.favorecido);
    if (!Number.isSafeInteger(favorecido) || favorecido <= 0) {
      return res.status(400).json({ sucesso: false, mensagem: 'Código do cliente inválido.' });
    }
    const dados = await precosHistoricosService.buscarPrecosHistoricos(favorecido, {
      item: req.query.item,
      descricao: req.query.descricao
    });
    return res.json({ sucesso: true, dados });
  } catch (error) {
    return res.status(error.statusCode || 502).json({
      sucesso: false,
      mensagem: 'Erro ao consultar os preços anteriores do produto.',
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
  buscarPerfilCompras,
  buscarPrecosHistoricos,
  enviarResumoImagemWhatsapp
};
