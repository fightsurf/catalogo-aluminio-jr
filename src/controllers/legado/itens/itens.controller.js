const itensService = require('../../../services/legado/itens/itens.service');

async function listarItens(req, res) {
  try {
    const resultado = await itensService.listarItens({
      descricao: req.query.descricao,
      limite: req.query.limite
    });

    return res.status(200).json(resultado);
  } catch (error) {
    console.error('Erro ao consultar itens do legado:', error);

    return res.status(500).json({
      erro: 'Erro ao consultar itens do sistema legado.',
      detalhe: error.message
    });
  }
}

async function buscarItem(req, res) {
  try {
    const resultado = await itensService.buscarItem(req.params.item);

    return res.status(200).json(resultado);
  } catch (error) {
    console.error('Erro ao buscar item do legado:', error);

    return res.status(400).json({
      erro: 'Erro ao buscar item do sistema legado.',
      detalhe: error.message
    });
  }
}

async function atualizarDescricao(req, res) {
  try {
    const resultado = await itensService.atualizarDescricaoItem({
      item: req.params.item,
      descricao: req.body?.descricao
    });

    return res.status(200).json(resultado);
  } catch (error) {
    console.error('Erro ao atualizar descrição do item legado:', error);

    return res.status(400).json({
      erro: 'Erro ao atualizar descrição do item do sistema legado.',
      detalhe: error.message
    });
  }
}

async function sincronizarDescricaoProduto(req, res) {
  try {
    const resultado = await itensService.sincronizarDescricaoProduto({
      produtoId: req.body?.produtoId,
      item: req.body?.item
    });

    return res.status(200).json(resultado);
  } catch (error) {
    console.error('Erro ao sincronizar produto para item legado:', error);

    return res.status(400).json({
      erro: 'Erro ao sincronizar descrição e preços do produto para o legado.',
      detalhe: error.message
    });
  }
}

async function associarProdutoAoItemLegado(req, res) {
  try {
    const resultado = await itensService.associarProdutoAoItemLegado({
      produtoId: req.body?.produtoId,
      item: req.body?.item
    });

    return res.status(200).json(resultado);
  } catch (error) {
    console.error('Erro ao associar produto do Render ao item legado:', error);

    return res.status(400).json({
      erro: 'Erro ao associar produto ao item do legado.',
      detalhe: error.message
    });
  }
}

async function desassociarProdutoDoItemLegado(req, res) {
  try {
    const resultado = await itensService.desassociarProdutoDoItemLegado({
      produtoId: req.params.produtoId
    });

    return res.status(200).json(resultado);
  } catch (error) {
    console.error('Erro ao desassociar produto do item legado:', error);

    return res.status(400).json({
      erro: 'Erro ao desassociar produto do item do legado.',
      detalhe: error.message
    });
  }
}

async function transferirAssociacaoProdutoAoItemLegado(req, res) {
  try {
    const resultado = await itensService.transferirAssociacaoProdutoAoItemLegado({
      produtoId: req.body?.produtoId,
      item: req.body?.item
    });

    return res.status(200).json(resultado);
  } catch (error) {
    console.error('Erro ao transferir associação do item legado:', error);

    return res.status(400).json({
      erro: 'Erro ao transferir associação do item legado.',
      detalhe: error.message
    });
  }
}

module.exports = {
  listarItens,
  buscarItem,
  atualizarDescricao,
  sincronizarDescricaoProduto,
  associarProdutoAoItemLegado,
  desassociarProdutoDoItemLegado,
  transferirAssociacaoProdutoAoItemLegado
};
