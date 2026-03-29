
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

  if (process.env.LEGADO_BRIDGE_API_KEY) {
    headers['x-api-key'] = process.env.LEGADO_BRIDGE_API_KEY;
  }

  const response = await fetch(`${getBridgeBaseUrl()}${path}`, {
    ...options,
    headers
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data?.detalhe || data?.erro || data?.message || `Falha HTTP ${response.status}`);
  }

  return data;
}

async function listarClientes(nome) {
  const response = await request(`/api/pagamentos/clientes?nome=${encodeURIComponent(nome || '')}`);
  return response.dados || [];
}

async function listarPedidosPorCliente(favorecido) {
  const response = await request(`/api/pagamentos/pedidos/por-cliente/${encodeURIComponent(favorecido)}`);
  return response.dados || [];
}

async function listarPedidosPorData(data) {
  const response = await request(`/api/pagamentos/pedidos/por-data?data=${encodeURIComponent(data || '')}`);
  return response.dados || [];
}

async function listarPedidosPorNumero(numero) {
  const response = await request(`/api/pagamentos/pedidos/por-numero?numero=${encodeURIComponent(numero || '')}`);
  return response.dados || [];
}

async function buscarPedidoComPagamentos({ empresa = -1, saida, pdv = 0 }) {
  const params = new URLSearchParams({ empresa: String(empresa), saida: String(saida), pdv: String(pdv) });
  const response = await request(`/api/pagamentos/pedido?${params.toString()}`);
  return response.dado || null;
}

async function criarPagamento(payload) {
  const response = await request('/api/pagamentos', {
    method: 'POST',
    body: JSON.stringify(payload)
  });

  return response.dado || null;
}

async function atualizarPagamento(codigo, payload) {
  const response = await request(`/api/pagamentos/${encodeURIComponent(codigo)}`, {
    method: 'PUT',
    body: JSON.stringify(payload)
  });

  return response.dado || null;
}

async function excluirPagamento(codigo, filtros = {}) {
  const params = new URLSearchParams();

  Object.entries(filtros).forEach(([chave, valor]) => {
    if (valor !== undefined && valor !== null && `${valor}` !== '') {
      params.set(chave, String(valor));
    }
  });

  const sufixo = params.toString() ? `?${params.toString()}` : '';
  const response = await request(`/api/pagamentos/${encodeURIComponent(codigo)}${sufixo}`, {
    method: 'DELETE'
  });

  return response.dado || null;
}

module.exports = {
  listarClientes,
  listarPedidosPorCliente,
  listarPedidosPorData,
  listarPedidosPorNumero,
  buscarPedidoComPagamentos,
  criarPagamento,
  atualizarPagamento,
  excluirPagamento
};
