const envioWhatsappService = require('../../whatsapp/envio-whatsapp.service');
const legadoBridgeService = require('../legadoBridge.service');

function limparTexto(valor) {
  if (valor === undefined || valor === null) {
    return '';
  }

  return String(valor).trim();
}

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

function formatarDataParaMensagem(valor) {
  if (!valor) {
    return '';
  }

  const data = new Date(valor);

  if (Number.isNaN(data.getTime())) {
    return limparTexto(valor).slice(0, 10);
  }

  return data.toLocaleDateString('pt-BR', {
    timeZone: 'America/Fortaleza'
  });
}

function montarMensagemCarrada({ tipo, pedido, carrada }) {
  const numeroPedido = limparTexto(pedido?.numero);
  const nomeCliente = limparTexto(pedido?.cliente?.nome);
  const dataCarrada = formatarDataParaMensagem(carrada?.data);
  const descricaoCarrada = limparTexto(carrada?.descricao);
  const acao = tipo === 'saida' ? 'saiu' : 'entrou';

  return [
    `🚚 Pedido: ${numeroPedido}`,
    `Cliente: ${nomeCliente}`,
    '',
    `Seu pedido ${acao} na produção da carrada do dia ${dataCarrada}`,
    descricaoCarrada
  ]
    .filter((linha, indice, linhas) => {
      if (indice === linhas.length - 1) {
        return Boolean(linha);
      }
      return true;
    })
    .join('\n');
}

async function enviarNotificacaoCarrada({ tipo, pedido, carrada }) {
  const telefone = limparTexto(pedido?.cliente?.telefonePrincipal);

  if (!telefone) {
    return { enviado: false, motivo: 'sem_telefone' };
  }

  const mensagem = montarMensagemCarrada({ tipo, pedido, carrada });

  try {
    await envioWhatsappService.enviarMensagem({ telefone, mensagem });
    return { enviado: true };
  } catch (error) {
    return { enviado: false, motivo: 'erro_envio', detalhe: error.message };
  }
}

async function enviarNotificacoesCriacao(carrada) {
  const pedidos = Array.isArray(carrada?.pedidos) ? carrada.pedidos : [];

  for (const pedido of pedidos) {
    await enviarNotificacaoCarrada({ tipo: 'entrada', pedido, carrada });
  }
}

async function enviarNotificacoesAtualizacao(carradaAntes, carradaDepois) {
  const pedidosAntes = Array.isArray(carradaAntes?.pedidos) ? carradaAntes.pedidos : [];
  const pedidosDepois = Array.isArray(carradaDepois?.pedidos) ? carradaDepois.pedidos : [];

  const mapaAntes = new Map(pedidosAntes.map((pedido) => [limparTexto(pedido?.numero), pedido]));
  const mapaDepois = new Map(pedidosDepois.map((pedido) => [limparTexto(pedido?.numero), pedido]));

  for (const [numero, pedidoDepois] of mapaDepois.entries()) {
    if (!numero || mapaAntes.has(numero)) continue;
    await enviarNotificacaoCarrada({ tipo: 'entrada', pedido: pedidoDepois, carrada: carradaDepois });
  }

  for (const [numero, pedidoAntes] of mapaAntes.entries()) {
    if (!numero || mapaDepois.has(numero)) continue;
    await enviarNotificacaoCarrada({ tipo: 'saida', pedido: pedidoAntes, carrada: carradaAntes });
  }
}

async function enviarNotificacoesExclusao(carrada) {
  const pedidos = Array.isArray(carrada?.pedidos) ? carrada.pedidos : [];

  for (const pedido of pedidos) {
    await enviarNotificacaoCarrada({ tipo: 'saida', pedido, carrada });
  }
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

async function buscarResumoCarrada(codigo) {
  return buscarCarrada(codigo);
}

async function criarCarrada(payload) {
  const response = await request('/api/carradas', {
    method: 'POST',
    body: JSON.stringify(payload)
  });

  const carrada = response.dado || null;

  if (carrada) {
    await enviarNotificacoesCriacao(carrada);
  }

  return carrada;
}

async function atualizarCarrada(codigo, payload) {
  const carradaAntes = await buscarCarrada(codigo);

  const response = await request(`/api/carradas/${codigo}`, {
    method: 'PUT',
    body: JSON.stringify(payload)
  });

  const carradaDepois = response.dado || null;

  if (carradaAntes && carradaDepois) {
    await enviarNotificacoesAtualizacao(carradaAntes, carradaDepois);
  }

  return carradaDepois;
}


async function vincularPedidoNaCarrada(codigo, payload) {
  const response = await request(`/api/carradas/${codigo}/pedidos`, {
    method: 'POST',
    body: JSON.stringify(payload || {})
  });

  const carrada = response.dado || null;
  let notificacao = null;

  if (carrada && payload?.numero) {
    const pedido = Array.isArray(carrada.pedidos)
      ? carrada.pedidos.find((item) => limparTexto(item?.numero) === limparTexto(payload.numero))
      : null;

    if (pedido) {
      notificacao = await enviarNotificacaoCarrada({ tipo: 'entrada', pedido, carrada });
    }
  }

  return { carrada, notificacao };
}

async function listarCarradasDisponiveis(codigo, dias = 120) {
  const response = await legadoBridgeService.get(`/api/carradas/${codigo}/carradas-disponiveis`, { dias });
  return response.dados || [];
}

async function moverPedidoEntreCarradas(codigo, payload = {}) {
  const carradaOrigemAntes = await buscarCarrada(codigo);

  const response = await request(`/api/carradas/${codigo}/pedidos/mover`, {
    method: 'POST',
    body: JSON.stringify(payload || {})
  });

  const dado = response.dado || null;
  const carradaOrigemDepois = dado?.origem || null;
  const carradaDestino = dado?.destino || null;
  const pedidoMovido = dado?.pedidoMovido || null;

  const pedidoAntes = Array.isArray(carradaOrigemAntes?.pedidos)
    ? carradaOrigemAntes.pedidos.find((item) => limparTexto(item?.numero) === limparTexto(payload?.numero))
    : null;

  if (pedidoAntes && carradaOrigemAntes) {
    await enviarNotificacaoCarrada({ tipo: 'saida', pedido: pedidoAntes, carrada: carradaOrigemAntes });
  }

  if (pedidoMovido && carradaDestino) {
    await enviarNotificacaoCarrada({ tipo: 'entrada', pedido: pedidoMovido, carrada: carradaDestino });
  }

  return {
    origem: carradaOrigemDepois,
    destino: carradaDestino,
    pedidoMovido
  };
}

async function excluirCarrada(codigo) {
  const carradaAntes = await buscarCarrada(codigo);

  const response = await request(`/api/carradas/${codigo}`, {
    method: 'DELETE'
  });

  if (carradaAntes) {
    await enviarNotificacoesExclusao(carradaAntes);
  }

  return response.dado || null;
}

module.exports = {
  listarClientes,
  listarPedidosPorCliente,
  listarPedidosPorData,
  listarPedidosPorNumero,
  listarCarradas,
  listarCarradasDisponiveis,
  buscarCarrada,
  buscarResumoCarrada,
  criarCarrada,
  atualizarCarrada,
  vincularPedidoNaCarrada,
  moverPedidoEntreCarradas,
  excluirCarrada
};
