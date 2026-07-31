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

    return res.status(200).json({
      success: true,
      message: data.repetida
        ? 'Publicação no Status já processada anteriormente.'
        : 'Produto publicado no Status do WhatsApp.',
      data,
    });
  } catch (error) {
    console.error('Erro ao publicar produto no Status do WhatsApp:', error);
    return res.status(502).json({
      success: false,
      message: 'Erro ao publicar o produto no Status do WhatsApp.',
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
