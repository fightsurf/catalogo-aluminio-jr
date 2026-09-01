const legadoBridgeService = require('../legadoBridge.service');

async function listarCheques(filtros = {}) {
  const response = await legadoBridgeService.get('/api/cheques', filtros);

  return {
    total: Number(response.total || 0),
    valorTotal: Number(response.valorTotal || 0),
    dados: Array.isArray(response.dados) ? response.dados : []
  };
}

module.exports = {
  listarCheques
};
