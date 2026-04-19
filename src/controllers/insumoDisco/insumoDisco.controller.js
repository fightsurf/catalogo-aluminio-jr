const service = require('../../services/insumoDisco/insumoDisco.service');

async function listar(req, res) {
  try {
    const dados = await service.listar(req.query);
    res.json({ success: true, data: dados });
  } catch (error) {
    console.error('ERRO LISTAR DISCOS:', error);
    res.status(500).json({ success: false, message: error.message });
  }
}

async function buscar(req, res) {
  try {
    const dados = await service.buscar(req.params.id);
    res.json({ success: true, data: dados });
  } catch (error) {
    const status = error.message === 'Disco de alumínio não encontrado' ? 404 : 400;
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
    const status = error.message === 'Disco de alumínio não encontrado' ? 404 : 400;
    res.status(status).json({ success: false, message: error.message });
  }
}

async function excluir(req, res) {
  try {
    await service.excluir(req.params.id);
    res.json({ success: true, message: 'Disco de alumínio removido com sucesso' });
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
