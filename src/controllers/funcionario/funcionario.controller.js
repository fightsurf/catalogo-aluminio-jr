const service = require('../../services/funcionario/funcionario.service');

function statusErro(error) {
  return /obrigat|inválid|invalido|máximo|maximo/i.test(String(error?.message || '')) ? 400 : 500;
}

async function listar(req, res) {
  try {
    const { nome, ativo } = req.query;
    return res.json(await service.listar(nome, ativo));
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

async function buscarPorId(req, res) {
  try {
    return res.json(await service.buscarPorId(req.params.id));
  } catch (error) {
    const status = /não encontrado/i.test(error.message) ? 404 : statusErro(error);
    return res.status(status).json({ error: error.message });
  }
}

async function criar(req, res) {
  try {
    const { nome } = req.body || {};
    if (!String(nome || '').trim()) return res.status(400).json({ error: 'Nome é obrigatório.' });
    return res.status(201).json(await service.criar(nome));
  } catch (error) {
    return res.status(statusErro(error)).json({ error: error.message });
  }
}

async function atualizar(req, res) {
  try {
    const { nome, ativo } = req.body || {};
    if (!String(nome || '').trim()) return res.status(400).json({ error: 'Nome é obrigatório.' });
    return res.json(await service.atualizar(req.params.id, nome, ativo));
  } catch (error) {
    const status = /não encontrado/i.test(error.message) ? 404 : statusErro(error);
    return res.status(status).json({ error: error.message });
  }
}

async function alterarStatus(req, res) {
  try {
    return res.json(await service.alterarStatus(req.params.id, req.body?.ativo));
  } catch (error) {
    const status = /não encontrado/i.test(error.message) ? 404 : statusErro(error);
    return res.status(status).json({ error: error.message });
  }
}

async function remover(req, res) {
  try {
    return res.json(await service.remover(req.params.id));
  } catch (error) {
    const status = /não encontrado/i.test(error.message) ? 404 : statusErro(error);
    return res.status(status).json({ error: error.message });
  }
}

module.exports = { listar, buscarPorId, criar, atualizar, alterarStatus, remover };
