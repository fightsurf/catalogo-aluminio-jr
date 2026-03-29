const legadoBridgeService = require('../legadoBridge.service');

function getBridgeBaseUrl() {
  const baseUrl = String(process.env.LEGADO_BRIDGE_URL || '').trim();

  if (!baseUrl) {
    throw new Error('LEGADO_BRIDGE_URL não configurada.');
  }

  return baseUrl.replace(/\/+$/, '');
}

async function request(path, options = {}) {
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };

  const response = await fetch(`${getBridgeBaseUrl()}${path}`, {
    ...options,
    headers
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data?.detalhe || data?.erro || `Falha HTTP ${response.status}`);
  }

  return data;
}

async function listarClientes(nome) {
  const response = await legadoBridgeService.get('/api/carradas/clientes', { nome });
  return response.dados || [];
}

async function listarPedidosPorCliente(favorecido) {
  const response = await legadoBridgeService.get(`/api/carradas/pedidos/por-cliente/${favorecido}`);
  return response.dados || [];
}

async function listarPedidosPorData(data) {
  const response = await legadoBridgeService.get('/api/carradas/pedidos/por-data', { data });
  return response.dados || [];
}

async function listarPedidosPorNumero(numero) {
  const response = await legadoBridgeService.get('/api/carradas/pedidos/por-numero', { numero });
  return response.dados || [];
}

async function listarCarradas() {
  const response = await legadoBridgeService.get('/api/carradas');
  return response.dados || [];
}

async function buscarCarrada(codigo) {
  const response = await legadoBridgeService.get(`/api/carradas/${codigo}`);
  return response.dado || null;
}

async function criarCarrada(payload) {
  const response = await request('/api/carradas', {
    method: 'POST',
    body: JSON.stringify(payload)
  });

  return response.dado || null;
}

async function atualizarCarrada(codigo, payload) {
  const response = await request(`/api/carradas/${codigo}`, {
    method: 'PUT',
    body: JSON.stringify(payload)
  });

  return response.dado || null;
}

async function excluirCarrada(codigo) {
  const response = await request(`/api/carradas/${codigo}`, {
    method: 'DELETE'
  });

  return response.dado || null;
}

module.exports = {
  listarClientes,
  listarPedidosPorCliente,
  listarPedidosPorData,
  listarPedidosPorNumero,
  listarCarradas,
  buscarCarrada,
  criarCarrada,
  atualizarCarrada,
  excluirCarrada
};
