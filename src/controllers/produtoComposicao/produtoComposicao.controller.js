const service = require('../../services/produtoComposicao/produtoComposicao.service');

async function listarInsumosDisponiveis(req, res) {
  try {
    const dados = await service.listarInsumosDisponiveis(req.query);
    res.json({ success: true, data: dados });
  } catch (error) {
    console.error('ERRO LISTAR INSUMOS PARA COMPOSIÇÃO:', error);
    res.status(500).json({ success: false, message: error.message });
  }
}

async function listarPorProduto(req, res) {
  try {
    const dados = await service.listarPorProduto(req.params.produtoId);
    res.json({ success: true, data: dados });
  } catch (error) {
    const status = error.message === 'Produto não encontrado' ? 404 : 400;
    res.status(status).json({ success: false, message: error.message });
  }
}

async function buscar(req, res) {
  try {
    const dados = await service.buscar(req.params.id);
    res.json({ success: true, data: dados });
  } catch (error) {
    const status = error.message === 'Composição não encontrada' ? 404 : 400;
    res.status(status).json({ success: false, message: error.message });
  }
}

async function salvarItensPorProduto(req, res) {
  try {
    const dados = await service.salvarItensPorProduto(req.params.produtoId, req.body.itens || []);
    res.json({ success: true, data: dados, message: 'Composição salva com sucesso' });
  } catch (error) {
    const status = error.message === 'Produto não encontrado' ? 404 : 400;
    res.status(status).json({ success: false, message: error.message });
  }
}

async function limparItensPorProduto(req, res) {
  try {
    const dados = await service.limparItensPorProduto(req.params.produtoId);
    res.json({ success: true, data: dados, message: 'Composição limpa com sucesso' });
  } catch (error) {
    const status = error.message === 'Produto não encontrado' ? 404 : 400;
    res.status(status).json({ success: false, message: error.message });
  }
}

async function copiarComposicao(req, res) {
  try {
    const dados = await service.copiarComposicao(req.body);
    res.json({ success: true, data: dados, message: 'Composição copiada com sucesso' });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
}

async function atualizarPrecoProduto(req, res) {
  try {
    const dados = await service.atualizarPrecoProduto(req.params.produtoId, req.body);
    res.json({ success: true, data: dados, message: 'Preço de venda atualizado com sucesso' });
  } catch (error) {
    const status = error.message === 'Produto não encontrado' ? 404 : 400;
    res.status(status).json({ success: false, message: error.message });
  }
}

async function criar(req, res) {
  try {
    const dados = await service.criar(req.body);
    res.status(201).json({ success: true, data: dados });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
}

async function atualizar(req, res) {
  try {
    const dados = await service.atualizar(req.params.id, req.body);
    res.json({ success: true, data: dados });
  } catch (error) {
    const status = error.message === 'Composição não encontrada' ? 404 : 400;
    res.status(status).json({ success: false, message: error.message });
  }
}

async function salvarItens(req, res) {
  try {
    const dados = await service.salvarItens(req.params.id, req.body.itens || []);
    res.json({ success: true, data: dados, message: 'Composição salva com sucesso' });
  } catch (error) {
    const status = error.message === 'Composição não encontrada' ? 404 : 400;
    res.status(status).json({ success: false, message: error.message });
  }
}

async function excluir(req, res) {
  try {
    const dados = await service.excluir(req.params.id);
    res.json({ success: true, data: dados, message: 'Composição limpa com sucesso' });
  } catch (error) {
    const status = error.message === 'Composição não encontrada' ? 404 : 400;
    res.status(status).json({ success: false, message: error.message });
  }
}

module.exports = {
  listarInsumosDisponiveis,
  listarPorProduto,
  buscar,
  salvarItensPorProduto,
  limparItensPorProduto,
  copiarComposicao,
  atualizarPrecoProduto,
  criar,
  atualizar,
  salvarItens,
  excluir
};
