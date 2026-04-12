const legadoBridgeService = require('../legadoBridge.service');

async function listarVendedores(filtros = {}) {
  const response = await legadoBridgeService.get('/api/vendedores', filtros);
  return response.dados || [];
}

async function buscarVendedor(favorecido) {
  const response = await legadoBridgeService.get(`/api/vendedores/${favorecido}`);
  return response.dado || null;
}

async function criarVendedor(payload) {
  const response = await legadoBridgeService.post('/api/vendedores', payload);
  return response.dado || null;
}

async function atualizarVendedor(favorecido, payload) {
  const response = await legadoBridgeService.put(`/api/vendedores/${favorecido}`, payload);
  return response.dado || null;
}

async function desativarVendedor(favorecido) {
  const response = await legadoBridgeService.delete(`/api/vendedores/${favorecido}`);
  return response.dado || null;
}

module.exports = {
  listarVendedores,
  buscarVendedor,
  criarVendedor,
  atualizarVendedor,
  desativarVendedor
};
