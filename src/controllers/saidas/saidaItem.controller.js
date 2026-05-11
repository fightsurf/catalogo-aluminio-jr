const service = require('../../services/saidas/saidaItem.service');

async function listar(req, res) {
  try {
    const data = await service.listar(req.query);
    res.json({ success: true, data });
  } catch (error) {
    console.error('ERRO LISTAR ITENS DE SAÍDA:', error);
    res.status(500).json({ success: false, message: error.message });
  }
}

async function buscar(req, res) {
  try {
    const data = await service.buscar(req.params.id);
    res.json({ success: true, data });
  } catch (error) {
    const status = error.message === 'Item de saída não encontrado' ? 404 : 400;
    res.status(status).json({ success: false, message: error.message });
  }
}

async function criar(req, res) {
  try {
    const data = await service.criar(req.body);
    res.status(201).json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
}

async function atualizar(req, res) {
  try {
    const data = await service.atualizar(req.params.id, req.body);
    res.json({ success: true, data });
  } catch (error) {
    const status = error.message === 'Item de saída não encontrado' ? 404 : 400;
    res.status(status).json({ success: false, message: error.message });
  }
}

async function excluir(req, res) {
  try {
    await service.excluir(req.params.id);
    res.json({ success: true, message: 'Item de saída removido com sucesso' });
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
