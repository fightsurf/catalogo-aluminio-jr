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
    console.error('Erro ao listar categorias para o Status:', error);
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
    console.error('Erro ao listar produtos para o Status:', error);
    return res.status(400).json({
      success: false,
      message: 'Não foi possível carregar os produtos da categoria.',
      error: error.message,
    });
  }
}

async function publicarProduto(req, res) {
  try {
    const data = await statusWhatsappService.publicarProduto({
      requestId: req.body.requestId,
      produtoId: req.body.produtoId,
      categoriaId: req.body.categoriaId,
    });

    return res.status(200).json({
      success: true,
      message: data.repetida
        ? 'Publicação já processada anteriormente.'
        : 'Produto enviado para o Status.',
      data,
    });
  } catch (error) {
    console.error('Erro ao publicar produto no Status:', error);
    return res.status(502).json({
      success: false,
      message: 'Erro ao publicar o produto no Status.',
      error: error.message,
    });
  }
}

module.exports = {
  verificarConexao,
  listarCategorias,
  listarProdutos,
  publicarProduto,
};
