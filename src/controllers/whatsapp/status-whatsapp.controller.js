const statusWhatsappService = require('../../services/whatsapp/status-whatsapp.service');

async function verificarConexao(req, res) {
  try {
    const data = await statusWhatsappService.verificarConexao();
    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error('Erro ao verificar conexão da Z-API:', error);
    return res.status(502).json({
      success: false,
      message: 'Não foi possível verificar a conexão do WhatsApp.',
      error: error.message,
    });
  }
}

async function listarCategorias(req, res) {
  try {
    const data = await statusWhatsappService.listarCategorias();
    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error('Erro ao listar categorias para envio no WhatsApp:', error);
    return res.status(500).json({
      success: false,
      message: 'Não foi possível carregar as categorias.',
      error: error.message,
    });
  }
}

async function listarProdutos(req, res) {
  try {
    const data = await statusWhatsappService.listarProdutosPorCategoria(req.query.categoriaId);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error('Erro ao listar produtos para envio no WhatsApp:', error);
    return res.status(400).json({
      success: false,
      message: 'Não foi possível carregar os produtos da categoria.',
      error: error.message,
    });
  }
}

async function enviarProduto(req, res) {
  try {
    const data = await statusWhatsappService.enviarProduto({
      requestId: req.body.requestId,
      produtoId: req.body.produtoId,
      categoriaId: req.body.categoriaId,
      telefone: req.body.telefone,
    });

    return res.status(200).json({
      success: true,
      message: data.repetida
        ? 'Envio já processado anteriormente.'
        : 'Produto enviado para o WhatsApp.',
      data,
    });
  } catch (error) {
    console.error('Erro ao enviar produto pelo WhatsApp:', error);
    return res.status(502).json({
      success: false,
      message: 'Erro ao enviar o produto pelo WhatsApp.',
      error: error.message,
    });
  }
}

async function publicarProdutoNoStatus(req, res) {
  try {
    const data = await statusWhatsappService.publicarProdutoNoStatus({
      requestId: req.body.requestId,
      produtoId: req.body.produtoId,
      categoriaId: req.body.categoriaId,
    });

    const mensagens = {
      publicado: data.repetida
        ? 'Publicação no WhatsApp e Instagram já processada anteriormente.'
        : 'Produto publicado no Status do WhatsApp e no Story do Instagram.',
      parcial: 'Produto publicado em apenas um dos canais. O canal com falha pode ser reenviado sem duplicar o que já deu certo.',
      erro: 'Não foi possível publicar o produto no WhatsApp nem no Instagram.',
    };

    return res.status(200).json({
      success: true,
      message: mensagens[data.status_geral] || 'Processamento de publicação concluído.',
      data,
    });
  } catch (error) {
    console.error('Erro ao publicar produto no Status do WhatsApp/Instagram:', error);
    return res.status(502).json({
      success: false,
      message: 'Erro ao processar a publicação do produto no WhatsApp/Instagram.',
      error: error.message,
    });
  }
}

module.exports = {
  verificarConexao,
  listarCategorias,
  listarProdutos,
  enviarProduto,
  publicarProdutoNoStatus,
};
