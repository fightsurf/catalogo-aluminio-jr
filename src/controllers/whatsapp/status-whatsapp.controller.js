const videos = require('../../services/whatsapp/statusProdutoVideo.service');
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
    if (req.body.tipoMidia === 'video') {
      const produtoId = Number(req.body.produtoId), categoriaId = Number(req.body.categoriaId);
      if (!Number.isSafeInteger(produtoId) || produtoId <= 0 || !Number.isSafeInteger(categoriaId) || categoriaId <= 0) throw new Error('Produto/categoria inválidos.');
      const produto = await statusWhatsappService.buscarProdutoParaEnvio(produtoId, categoriaId, 'video');
      const data = await videos.iniciar({requestId:req.body.requestId,produto});
      return res.status(data.status === 'concluido' ? 200 : 202).json({success:true,data});
    }
    if (req.body.tipoMidia && req.body.tipoMidia !== 'foto') throw new Error('Tipo de mídia inválido.');
    const data = await statusWhatsappService.publicarProdutoNoStatus({
      requestId: req.body.requestId,
      produtoId: req.body.produtoId,
      categoriaId: req.body.categoriaId,
    });

    const mensagens = {
      publicado: data.repetida
        ? 'Publicação nos Stories do WhatsApp, Instagram e Facebook já processada anteriormente.'
        : 'Produto publicado no Status do WhatsApp e nos Stories do Instagram e Facebook.',
      parcial: 'Produto publicado em apenas um dos canais. O canal com falha pode ser reenviado sem duplicar o que já deu certo.',
      erro: 'Não foi possível publicar o produto no WhatsApp, Instagram nem Facebook Story.',
    };

    return res.status(200).json({
      success: true,
      message: mensagens[data.status_geral] || 'Processamento de publicação concluído.',
      data,
    });
  } catch (error) {
    console.error('Erro ao publicar produto no WhatsApp/Instagram/Facebook Story:', error);
    return res.status(502).json({
      success: false,
      message: 'Erro ao processar a publicação do produto no WhatsApp/Instagram/Facebook.',
      error: error.message,
    });
  }
}

async function publicarCategoriaFacebook(req, res) {
  try {
    const data = await statusWhatsappService.publicarCategoriaFacebook({
      requestId: req.body.requestId,
      categoriaId: req.body.categoriaId,
    });

    return res.status(200).json({
      success: true,
      message: data.repetida
        ? 'Carrossel da categoria já publicado anteriormente no Facebook.'
        : 'Categoria publicada em carrossel no feed do Facebook.',
      data,
    });
  } catch (error) {
    console.error('Erro ao publicar categoria no feed do Facebook:', error);
    return res.status(502).json({
      success: false,
      message: 'Erro ao publicar a categoria no feed do Facebook.',
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
  publicarCategoriaFacebook,
};

async function consultarVideo(req,res) {
  try { res.json({success:true,data:await videos.consultar(req.params.requestId)}); }
  catch(error){res.status(400).json({success:false,error:error.message});}
}
module.exports.consultarVideo = consultarVideo;
