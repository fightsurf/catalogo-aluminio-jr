const service = require('../../services/insumoFornecedor/insumoFornecedor.service');

async function listar(req, res) {
  try {
    const dados = await service.listar(req.query);
    res.json({ success: true, data: dados });
  } catch (error) {
    console.error('ERRO LISTAR CUSTOS DE INSUMOS POR FORNECEDOR:', error);
    res.status(500).json({ success: false, message: error.message });
  }
}

async function buscar(req, res) {
  try {
    const dados = await service.buscar(req.params.id);
    res.json({ success: true, data: dados });
  } catch (error) {
    const status = error.message === 'Registro de custo não encontrado' ? 404 : 400;
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
    const status = error.message === 'Registro de custo não encontrado' ? 404 : 400;
    res.status(status).json({ success: false, message: error.message });
  }
}

async function inativar(req, res) {
  try {
    const dados = await service.inativar(req.params.id);
    res.json({ success: true, data: dados, message: 'Registro de custo inativado com sucesso' });
  } catch (error) {
    const status = error.message === 'Registro de custo não encontrado' ? 404 : 400;
    res.status(status).json({ success: false, message: error.message });
  }
}

async function excluir(req, res) {
  try {
    await service.excluir(req.params.id);
    res.json({ success: true, message: 'Registro de custo excluído com sucesso' });
  } catch (error) {
    const status = error.message === 'Registro de custo não encontrado' ? 404 : 400;
    res.status(status).json({ success: false, message: error.message });
  }
}

module.exports = {
  listar,
  buscar,
  criar,
  atualizar,
  inativar,
  excluir
};
