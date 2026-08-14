const envioWhatsappService = require('../../whatsapp/envio-whatsapp.service');
const legadoBridgeService = require('../legadoBridge.service');
const carradasStatusResumoService = require('../carradas-progresso/carradas-status-resumo.service');

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


async function mapearComConcorrencia(itens, limite, worker) {
  const lista = Array.isArray(itens) ? itens : [];
  const maximo = Number.isInteger(limite) && limite > 0 ? limite : 1;
  const resultados = new Array(lista.length);
  let indiceAtual = 0;

  async function executar() {
    while (true) {
      const indice = indiceAtual;
      indiceAtual += 1;

      if (indice >= lista.length) {
        return;
      }

      resultados[indice] = await worker(lista[indice], indice);
    }
  }

  const workers = Array.from({ length: Math.min(maximo, lista.length) }, () => executar());
  await Promise.all(workers);
  return resultados;
}

function calcularQuantidadeItensPedido(pedido) {
  if (pedido && !Array.isArray(pedido.itens)) {
    const quantidadeResumo = Number(pedido.quantidadeItens ?? pedido.quantidade_itens);

    if (Number.isFinite(quantidadeResumo)) {
      return quantidadeResumo;
    }
  }

  const itens = Array.isArray(pedido?.itens) ? pedido.itens : [];
  return itens.reduce((total, item) => total + Number(item?.quantidade || 0), 0);
}

function obterPedidosResumoCarrada(carrada) {
  if (Array.isArray(carrada?.pedidos)) {
    return carrada.pedidos;
  }

  if (Array.isArray(carrada?.pedidosResumo)) {
    return carrada.pedidosResumo;
  }

  if (Array.isArray(carrada?.pedidos_resumo)) {
    return carrada.pedidos_resumo;
  }

  return [];
}

function montarResumoProducaoCarrada(carrada, pedidosProntosSet = new Set()) {
  const pedidos = obterPedidosResumoCarrada(carrada);
  const pedidosComStatus = [];

  const resumo = pedidos.reduce((acc, pedido) => {
    const quantidadeItensPedido = calcularQuantidadeItensPedido(pedido);
    const pedidoPronto = carradasStatusResumoService.pedidoEstaPronto(pedido, pedidosProntosSet);

    acc.quantidadePedidos += 1;
    acc.quantidadeItens += quantidadeItensPedido;
    acc.totalPedidos += Number(pedido?.total || 0);

    if (pedidoPronto) {
      acc.quantidadePedidosProntos += 1;
      acc.quantidadeItensProntos += quantidadeItensPedido;
    } else {
      acc.quantidadePedidosAProduzir += 1;
      acc.quantidadeItensAProduzir += quantidadeItensPedido;
    }

    pedidosComStatus.push({
      ...pedido,
      pedidoPronto,
      quantidadeItens: quantidadeItensPedido,
      quantidade_itens: quantidadeItensPedido
    });

    return acc;
  }, {
    quantidadePedidos: 0,
    quantidadePedidosProntos: 0,
    quantidadePedidosAProduzir: 0,
    quantidadeItens: 0,
    quantidadeItensProntos: 0,
    quantidadeItensAProduzir: 0,
    totalPedidos: 0
  });

  return {
    resumo,
    pedidosComStatus
  };
}

function aplicarResumoProducaoCarrada(carrada, resumo, pedidosComStatus = null) {
  const quantidadePedidos = Number(resumo?.quantidadePedidos || 0);
  const quantidadePedidosProntos = Number(resumo?.quantidadePedidosProntos || 0);
  const quantidadePedidosAProduzir = Number(resumo?.quantidadePedidosAProduzir || 0);
  const quantidadeItens = Number(resumo?.quantidadeItens || 0);
  const quantidadeItensProntos = Number(resumo?.quantidadeItensProntos || 0);
  const quantidadeItensAProduzir = Number(resumo?.quantidadeItensAProduzir || 0);
  const totalPedidos = Number(resumo?.totalPedidos || 0);

  return {
    ...carrada,
    ...(pedidosComStatus ? { pedidos: pedidosComStatus } : {}),
    totalPedidos: quantidadePedidos,
    totalPedidosProntos: quantidadePedidosProntos,
    totalPedidosAProduzir: quantidadePedidosAProduzir,
    quantidadePedidos,
    quantidadePedidosProntos,
    quantidadePedidosAProduzir,
    quantidadeItens,
    quantidadeItensProntos,
    quantidadeItensAProduzir,
    valorTotalPedidos: totalPedidos,
    quantidade_pedidos: quantidadePedidos,
    quantidade_pedidos_prontos: quantidadePedidosProntos,
    quantidade_pedidos_a_produzir: quantidadePedidosAProduzir,
    quantidade_itens: quantidadeItens,
    quantidade_itens_prontos: quantidadeItensProntos,
    quantidade_itens_a_produzir: quantidadeItensAProduzir,
    total_pedidos: totalPedidos,
    resumoProducao: {
      quantidadePedidos,
      quantidadePedidosProntos,
      quantidadePedidosAProduzir,
      quantidadeItens,
      quantidadeItensProntos,
      quantidadeItensAProduzir,
      totalPedidos
    }
  };
}

async function buscarSetPedidosProntosSemQuebrar(pedidos) {
  try {
    return await carradasStatusResumoService.buscarSetPedidosProntos(pedidos);
  } catch (error) {
    console.error('Falha ao buscar pedidos prontos:', error.message);
    return new Set();
  }
}

async function buscarCarradaDoLegado(codigo) {
  const response = await legadoBridgeService.get(`/api/carradas/${codigo}`);
  return response.dado || null;
}

async function enriquecerCarradaComResumoProducao(carrada, opcoes = {}) {
  if (!carrada) {
    return null;
  }

  const pedidos = Array.isArray(carrada?.pedidos) ? carrada.pedidos : [];
  const pedidosProntosSet = opcoes.pedidosProntosSet || await buscarSetPedidosProntosSemQuebrar(pedidos);
  const { resumo, pedidosComStatus } = montarResumoProducaoCarrada(carrada, pedidosProntosSet);

  return aplicarResumoProducaoCarrada(
    carrada,
    resumo,
    opcoes.incluirPedidos === false ? null : pedidosComStatus
  );
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
  const textoMovimentacao = tipo === 'saida'
    ? `O pedido saiu da carrada do dia ${dataCarrada}`
    : `Seu pedido entrou na produção da carrada do dia ${dataCarrada}`;

  return [
    `🚚 Pedido: ${numeroPedido}`,
    `Cliente: ${nomeCliente}`,
    '',
    textoMovimentacao,
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

async function listarCarradas(opcoes = {}) {
  const incluirResumoProducao = opcoes.incluirResumoProducao !== false;
  let response;

  if (incluirResumoProducao) {
    try {
      const query = {};
      if (opcoes.dias) {
        query.dias = opcoes.dias;
      }
      if (Array.isArray(opcoes.codigos) && opcoes.codigos.length) {
        query.codigos = opcoes.codigos.join(',');
      } else if (opcoes.codigos) {
        query.codigos = opcoes.codigos;
      }

      response = await legadoBridgeService.get('/api/carradas/resumo-producao-lista', query);
    } catch (error) {
      console.error('Falha ao buscar resumo otimizado das carradas. Usando listagem simples:', error.message);
      response = await legadoBridgeService.get('/api/carradas');
    }
  } else {
    response = await legadoBridgeService.get('/api/carradas');
  }

  const carradas = response.dados || [];
  const codigos = carradas
    .map((item) => Number.parseInt(item?.codigo, 10))
    .filter((codigo) => Number.isInteger(codigo) && codigo > 0);

  let mapaStatus = new Map();

  try {
    mapaStatus = await carradasStatusResumoService.buscarMapaStatusPorCodigos(codigos);
  } catch (error) {
    console.error('Falha ao buscar status persistido das carradas:', error.message);
  }

  if (!incluirResumoProducao) {
    return carradas.map((carrada) => {
      const codigo = Number.parseInt(carrada?.codigo, 10);
      const status = mapaStatus.get(codigo);

      return {
        ...carrada,
        progressoStatusLinha: status?.statusLinha || 'incompleta',
        vendasBloqueadas: Boolean(status?.vendasBloqueadas)
      };
    });
  }

  const todosPedidos = carradas.flatMap((carrada) => obterPedidosResumoCarrada(carrada));
  const pedidosProntosSet = await buscarSetPedidosProntosSemQuebrar(todosPedidos);

  return carradas.map((carrada) => {
    const codigo = Number.parseInt(carrada?.codigo, 10);
    const status = mapaStatus.get(codigo);
    const { resumo } = montarResumoProducaoCarrada(carrada, pedidosProntosSet);
    const carradaComResumo = aplicarResumoProducaoCarrada(carrada, resumo, null);

    return {
      ...carradaComResumo,
      pedidos: undefined,
      pedidosResumo: undefined,
      pedidos_resumo: undefined,
      progressoStatusLinha: status?.statusLinha || 'incompleta',
      vendasBloqueadas: Boolean(status?.vendasBloqueadas)
    };
  });
}


async function recalcularStatusCarradaSemQuebrar(codigoCarrada) {
  const codigo = Number.parseInt(codigoCarrada, 10);

  if (!Number.isInteger(codigo) || codigo <= 0) {
    return;
  }

  try {
    await carradasStatusResumoService.recalcularStatusCarrada(codigo);
  } catch (error) {
    console.error(`Falha ao recalcular status da carrada ${codigo}:`, error.message);
  }
}

async function excluirStatusCarradaSemQuebrar(codigoCarrada) {
  const codigo = Number.parseInt(codigoCarrada, 10);

  if (!Number.isInteger(codigo) || codigo <= 0) {
    return;
  }

  try {
    await carradasStatusResumoService.excluirStatusCarrada(codigo);
  } catch (error) {
    console.error(`Falha ao excluir status persistido da carrada ${codigo}:`, error.message);
  }
}

async function buscarCarrada(codigo) {
  const carrada = await buscarCarradaDoLegado(codigo);
  const enriquecida = await enriquecerCarradaComResumoProducao(carrada);

  if (!enriquecida) {
    return null;
  }

  const codigoNormalizado = Number.parseInt(enriquecida?.codigo ?? codigo, 10);
  let status = null;

  try {
    const mapaStatus = await carradasStatusResumoService.buscarMapaStatusPorCodigos([codigoNormalizado]);
    status = mapaStatus.get(codigoNormalizado) || null;
  } catch (error) {
    console.error(`Falha ao buscar bloqueio de vendas da carrada ${codigoNormalizado}:`, error.message);
  }

  return {
    ...enriquecida,
    progressoStatusLinha: status?.statusLinha || 'incompleta',
    vendasBloqueadas: Boolean(status?.vendasBloqueadas)
  };
}

async function atualizarBloqueioVendas(codigo, bloqueado) {
  const codigoNormalizado = Number.parseInt(codigo, 10);

  if (!Number.isInteger(codigoNormalizado) || codigoNormalizado <= 0) {
    const error = new Error('Código da carrada inválido.');
    error.statusCode = 400;
    throw error;
  }

  const carrada = await buscarCarradaDoLegado(codigoNormalizado);

  if (!carrada) {
    const error = new Error('Carrada não encontrada.');
    error.statusCode = 404;
    throw error;
  }

  const status = await carradasStatusResumoService.salvarVendasBloqueadas(codigoNormalizado, bloqueado);

  return {
    codigo: codigoNormalizado,
    vendasBloqueadas: Boolean(status?.vendasBloqueadas)
  };
}

async function buscarResumoCarrada(codigo) {
  return buscarCarrada(codigo);
}

async function listarDetalhesCarradasPorCodigos(codigosParam = []) {
  const codigos = [...new Set(
    (Array.isArray(codigosParam) ? codigosParam : String(codigosParam || '').split(','))
      .map((codigo) => Number.parseInt(codigo, 10))
      .filter((codigo) => Number.isInteger(codigo) && codigo > 0)
  )];

  if (!codigos.length) {
    return [];
  }

  const response = await legadoBridgeService.get('/api/carradas/detalhes-producao-lista', {
    codigos: codigos.join(',')
  });

  const carradas = Array.isArray(response?.dados) ? response.dados : [];
  const todosPedidos = carradas.flatMap((carrada) => Array.isArray(carrada?.pedidos) ? carrada.pedidos : []);
  const pedidosProntosSet = await buscarSetPedidosProntosSemQuebrar(todosPedidos);

  const enriquecidas = await Promise.all(
    carradas.map((carrada) => enriquecerCarradaComResumoProducao(carrada, { pedidosProntosSet }))
  );

  const mapa = new Map(
    enriquecidas
      .filter(Boolean)
      .map((carrada) => [Number.parseInt(carrada.codigo, 10), carrada])
  );

  return codigos
    .map((codigo) => mapa.get(codigo))
    .filter(Boolean);
}

async function criarCarrada(payload) {
  const response = await request('/api/carradas', {
    method: 'POST',
    body: JSON.stringify(payload)
  });

  const carrada = response.dado || null;

  if (carrada) {
    await enviarNotificacoesCriacao(carrada);
    await recalcularStatusCarradaSemQuebrar(carrada.codigo);
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

  if (carradaDepois) {
    await recalcularStatusCarradaSemQuebrar(carradaDepois.codigo);
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

  if (carrada) {
    await recalcularStatusCarradaSemQuebrar(carrada.codigo);
  }

  return { carrada, notificacao };
}

async function listarCarradasDisponiveis(codigo, dias = 120) {
  const response = await legadoBridgeService.get(`/api/carradas/${codigo}/carradas-disponiveis`, { dias });
  return response.dados || [];
}

async function moverPedidoEntreCarradas(codigo, payload = {}) {
  const enviarWhatsapp = payload?.enviarWhatsapp !== false;
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

  if (enviarWhatsapp && pedidoAntes && carradaOrigemAntes) {
    await enviarNotificacaoCarrada({ tipo: 'saida', pedido: pedidoAntes, carrada: carradaOrigemAntes });
  }

  if (enviarWhatsapp && pedidoMovido && carradaDestino) {
    await enviarNotificacaoCarrada({ tipo: 'entrada', pedido: pedidoMovido, carrada: carradaDestino });
  }

  if (carradaOrigemAntes?.codigo) {
    await recalcularStatusCarradaSemQuebrar(carradaOrigemAntes.codigo);
  }

  if (carradaOrigemDepois?.codigo && Number(carradaOrigemDepois.codigo) !== Number(carradaOrigemAntes?.codigo)) {
    await recalcularStatusCarradaSemQuebrar(carradaOrigemDepois.codigo);
  }

  if (carradaDestino?.codigo) {
    await recalcularStatusCarradaSemQuebrar(carradaDestino.codigo);
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

  await excluirStatusCarradaSemQuebrar(codigo);

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
  atualizarBloqueioVendas,
  listarDetalhesCarradasPorCodigos,
  criarCarrada,
  atualizarCarrada,
  vincularPedidoNaCarrada,
  moverPedidoEntreCarradas,
  excluirCarrada
};
