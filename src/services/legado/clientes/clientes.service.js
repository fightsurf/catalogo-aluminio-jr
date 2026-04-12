const legadoBridgeService = require('../legadoBridge.service');

async function listarClientes(filtros = {}) {
  const response = await legadoBridgeService.get('/api/clientes', filtros);
  return response.dados || [];
}

async function buscarCliente(favorecido) {
  const response = await legadoBridgeService.get(`/api/clientes/${favorecido}`);
  return response.dado || null;
}

async function criarCliente(payload) {
  const response = await legadoBridgeService.post('/api/clientes', payload);
  return response.dado || null;
}

async function atualizarCliente(favorecido, payload) {
  const response = await legadoBridgeService.put(`/api/clientes/${favorecido}`, payload);
  return response.dado || null;
}

async function desativarCliente(favorecido) {
  const response = await legadoBridgeService.delete(`/api/clientes/${favorecido}`);
  return response.dado || null;
}

module.exports = {
  listarClientes,
  buscarCliente,
  criarCliente,
  atualizarCliente,
  desativarCliente
};
