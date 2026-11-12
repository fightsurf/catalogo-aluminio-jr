const service = require('../../services/produtoResumoCusto/produtoResumoCusto.service');

async function listar(req, res) {
  try {
    const dados = await service.listar(req.query);
    res.json({ success: true, data: dados });
  } catch (error) {
    console.error('ERRO RESUMO CUSTOS PRODUTOS:', error);
    res.status(500).json({ success: false, message: error.message });
  }
}

async function listarPrecificacao(req, res) {
  try {
    const dados = await service.listarPrecificacao(req.query);
    res.json({ success: true, data: dados });
  } catch (error) {
    console.error('ERRO PRECIFICACAO PRODUTOS:', error);
    res.status(500).json({ success: false, message: error.message });
  }
}

async function atualizarPrecoVenda(req, res) {
  try {
    const dados = await service.atualizarPrecoVenda(req.params.id, req.body?.preco);
    res.json({ success: true, data: dados });
  } catch (error) {
    console.error('ERRO ATUALIZACAO PRECO VENDA:', error);
    res.status(error.status || 500).json({ success: false, message: error.message });
  }
}

module.exports = {
  listar,
  listarPrecificacao,
  atualizarPrecoVenda
};
