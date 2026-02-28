
const service = require('../../services/produtoCategoria/produtoCategoria.service');

async function listar(req, res) {
  try {
    const dados = await service.listar();
    res.json({ success: true, data: dados });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

async function buscar(req, res) {
  try {
    const dados = await service.buscar(req.params.id);
    res.json({ success: true, data: dados });
  } catch (error) {
    res.status(404).json({ success: false, message: error.message });
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
    res.status(400).json({ success: false, message: error.message });
  }
}

async function excluir(req, res) {
  try {
    await service.excluir(req.params.id);
    res.json({ success: true, message: 'Categoria removida' });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
}

module.exports = {
  listar,
  buscar,
  criar,
  atualizar,
  excluir
};
