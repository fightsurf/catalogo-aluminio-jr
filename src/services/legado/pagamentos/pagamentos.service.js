
const clientesCreditosService = require('../clientes-creditos/clientes-creditos.service');

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

async function listarPagamentosRealizados(filtros = {}) {
  const params = new URLSearchParams();

  if (filtros.dataInicial || filtros.data_inicial) {
    params.set('dataInicial', filtros.dataInicial || filtros.data_inicial);
  }

  if (filtros.dataFinal || filtros.data_final) {
    params.set('dataFinal', filtros.dataFinal || filtros.data_final);
  }

  const sufixo = params.toString() ? `?${params.toString()}` : '';
  const response = await request(`/api/pagamentos/realizados${sufixo}`);

  return {
    total: Number(response.total || 0),
    valorTotal: Number(response.valorTotal || 0),
    dados: Array.isArray(response.dados) ? response.dados : []
  };
}

async function listarClientes(nome) {
  const response = await request(`/api/pagamentos/clientes?nome=${encodeURIComponent(nome || '')}`);
  return response.dados || [];
}

async function listarPedidosPorCliente(favorecido) {
  const response = await request(`/api/pagamentos/pedidos/por-cliente/${encodeURIComponent(favorecido)}`);
  return clientesCreditosService.aplicarBaixasEmPedidos(response.dados || []);
}

async function listarPedidosPorData(data) {
  const response = await request(`/api/pagamentos/pedidos/por-data?data=${encodeURIComponent(data || '')}`);
  return clientesCreditosService.aplicarBaixasEmPedidos(response.dados || []);
}

async function listarPedidosPorNumero(numero) {
  const response = await request(`/api/pagamentos/pedidos/por-numero?numero=${encodeURIComponent(numero || '')}`);
  return clientesCreditosService.aplicarBaixasEmPedidos(response.dados || []);
}

async function buscarPedidoComPagamentos({ empresa = -1, saida, pdv = 0 }) {
  const params = new URLSearchParams({ empresa: String(empresa), saida: String(saida), pdv: String(pdv) });
  const response = await request(`/api/pagamentos/pedido?${params.toString()}`);
  return clientesCreditosService.aplicarBaixaEmDetalhe(response.dado || null);
}


async function baixarPedidoParaCredito(payload = {}) {
  const empresa = payload.empresa ?? -1;
  const saida = payload.saida;
  const pdv = payload.pdv ?? 0;

  const params = new URLSearchParams({ empresa: String(empresa), saida: String(saida), pdv: String(pdv) });
  const response = await request(`/api/pagamentos/pedido?${params.toString()}`);
  const detalhe = response.dado || null;

  if (!detalhe?.pedido) {
    throw new Error('Pedido não encontrado para baixa para crédito.');
  }

  const baixaExistente = await clientesCreditosService.buscarBaixaPedido({ empresa, saida, pdv });
  if (baixaExistente) {
    return clientesCreditosService.aplicarBaixaEmDetalhe(detalhe);
  }

  const saldoRestante = Number(detalhe?.resumo?.saldoRestante || 0);
  if (!Number.isFinite(saldoRestante) || saldoRestante <= 0.009) {
    throw new Error('Este pedido não possui saldo devedor para baixa para crédito.');
  }

  await clientesCreditosService.criarBaixaParaCredito({
    detalhePedido: detalhe,
    valor: saldoRestante,
    observacao: payload.observacao || null
  });

  return clientesCreditosService.aplicarBaixaEmDetalhe(detalhe);
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
  listarPagamentosRealizados,
  listarClientes,
  listarPedidosPorCliente,
  listarPedidosPorData,
  listarPedidosPorNumero,
  buscarPedidoComPagamentos,
  baixarPedidoParaCredito,
  criarPagamento,
  atualizarPagamento,
  excluirPagamento
};
