const dashboardPedidosService = require('../../../services/legado/dashboard-pedidos/dashboard-pedidos.service');

async function obterDashboardPedidos(req, res) {
  try {
    const data = await dashboardPedidosService.obterDashboardPedidos();
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Erro ao carregar dashboard de pedidos.', error: error.message });
  }
}

module.exports = {
  obterDashboardPedidos
};
