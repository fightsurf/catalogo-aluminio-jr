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

module.exports = {
  listar
};
