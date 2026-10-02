const legadoBridgeService = require('../legado/legadoBridge.service');

async function listar(nome, ativo) {
  return legadoBridgeService.get('/api/funcionarios', { nome, ativo });
}

async function buscarPorId(id) {
  return legadoBridgeService.get(`/api/funcionarios/${encodeURIComponent(id)}`);
}

async function criar(nome, cargo, custohora) {
  return legadoBridgeService.post('/api/funcionarios', { nome, cargo, custohora });
}

async function atualizar(id, nome, cargo, custohora, ativo) {
  return legadoBridgeService.put(`/api/funcionarios/${encodeURIComponent(id)}`, {
    nome, cargo, custohora, ativo
  });
}

async function alterarStatus(id, ativo) {
  return legadoBridgeService.patch(`/api/funcionarios/${encodeURIComponent(id)}/status`, { ativo });
}

async function remover(id) {
  return legadoBridgeService.delete(`/api/funcionarios/${encodeURIComponent(id)}`);
}

module.exports = { listar, buscarPorId, criar, atualizar, alterarStatus, remover };
