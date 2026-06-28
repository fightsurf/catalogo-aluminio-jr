const legadoBridgeService = require('../legado/legadoBridge.service');

async function carregarPerformanceMensal(filtros = {}) {
  const response = await legadoBridgeService.get('/api/vendas/performance-vendas', {
    mes: filtros.mes,
    ano: filtros.ano
  });

  return response.dados || {
    regra: 'Vendas agrupadas por SAIDAS.DATA. Pedidos cancelados são ignorados.',
    atual: null,
    anterior: null
  };
}

module.exports = {
  carregarPerformanceMensal
};
