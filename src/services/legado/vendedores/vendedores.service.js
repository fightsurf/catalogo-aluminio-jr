const legadoBridgeService = require('../legadoBridge.service');

async function listarVendedores() {
  const response = await legadoBridgeService.get('/api/vendedores');
  return response.dados || [];
}

module.exports = {
  listarVendedores
};
