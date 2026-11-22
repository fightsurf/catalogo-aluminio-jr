const produtoService = require('../../produto/produto.service');
const clientesService = require('../clientes/clientes.service');
const whatsapp = require('../../whatsapp/envio-whatsapp.service');
const controleWhatsapp = require('../../whatsapp/central-controle.service');

function getBridgeBaseUrl() {
  return (
    process.env.LEGADO_BRIDGE_URL ||
    process.env.LEGACY_FIREBIRD_API_URL ||
    ''
  ).replace(/\/$/, '');
}

function limparTexto(valor) {
  if (valor === undefined || valor === null) {
    return '';
  }

  return String(valor).trim();
}

function normalizarNumero(valor, nomeCampo) {
  const numero = Number(valor);

  if (!Number.isFinite(numero)) {
    throw new Error(`Campo inválido: ${nomeCampo}`);
  }

  return numero;
}

function normalizarInteiroPositivo(valor, nomeCampo) {
  const numero = Number(valor);

  if (!Number.isInteger(numero) || numero <= 0) {
    throw new Error(`Campo inválido: ${nomeCampo}`);
  }

  return numero;
}

async function resolverItemDoLegado(itemEntrada, indice) {
  const produtoId = itemEntrada?.produto_id ?? itemEntrada?.produtoId;

  if (produtoId === undefined || produtoId === null || String(produtoId).trim() === '') {
    const itemLegado = itemEntrada?.item;
    const descricao = limparTexto(itemEntrada?.descricao);

    if (!itemLegado || !descricao) {
      throw new Error(`Item ${indice + 1}: informe produto_id ou item/descricao do legado.`);
    }

    return {
      item: normalizarInteiroPositivo(itemLegado, `itens[${indice}].item`),
      descricao,
      quantidade: normalizarNumero(itemEntrada?.quantidade, `itens[${indice}].quantidade`),
      preco: normalizarNumero(itemEntrada?.preco, `itens[${indice}].preco`)
    };
  }

  const produto = await produtoService.buscar(produtoId);
  const itemLegado = produto?.item_legado;

  if (!itemLegado) {
    throw new Error(`Produto "${limparTexto(produto?.nome) || `ID ${produtoId}`}" está sem vínculo com item do legado.`);
  }

  return {
    item: normalizarInteiroPositivo(itemLegado, `itens[${indice}].produto_id`),
    descricao: limparTexto(produto?.nome) || `Produto ${produtoId}`,
    quantidade: normalizarNumero(itemEntrada?.quantidade, `itens[${indice}].quantidade`),
    preco: normalizarNumero(itemEntrada?.preco, `itens[${indice}].preco`)
  };
}

async function prepararPayloadLegado(payload = {}) {
  const itensEntrada = Array.isArray(payload?.itens) ? payload.itens : [];

  if (!itensEntrada.length) {
    throw new Error('Informe ao menos 1 item para o pedido.');
  }

  const itens = [];

  for (let i = 0; i < itensEntrada.length; i += 1) {
    const itemResolvido = await resolverItemDoLegado(itensEntrada[i], i);

    if (itemResolvido.quantidade <= 0) {
      throw new Error(`Item ${i + 1}: quantidade deve ser maior que zero.`);
    }

    if (itemResolvido.preco < 0) {
      throw new Error(`Item ${i + 1}: preço não pode ser negativo.`);
    }

    itens.push(itemResolvido);
  }

    const carradaCodigoBruto = payload?.carrada_codigo ?? payload?.carradaCodigo ?? null;
  const carradaCodigo =
    carradaCodigoBruto === undefined || carradaCodigoBruto === null || String(carradaCodigoBruto).trim() === ''
      ? null
      : normalizarInteiroPositivo(carradaCodigoBruto, 'carrada_codigo');

  return {
    data: payload?.data,
    favorecido: payload?.favorecido,
    obs: payload?.obs,
    vendedor: payload?.vendedor,
    volumes: payload?.volumes,
    total: payload?.total,
    carrada_codigo: carradaCodigo,
    itens
  };
}


function formatarDataCarrada(valor) {
  const texto = limparTexto(valor);
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(texto);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  const data = new Date(texto);
  return Number.isNaN(data.getTime())
    ? (texto || '-')
    : data.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

// Reutilizada por qualquer entrada de pedido (tela e MCP) que autorize o aviso.
// O envio ocorre somente se a vinculação à carrada foi confirmada pelo bridge.
async function notificarEntradaCarrada({ favorecido, numeroPedido, carrada }) {
  try {
    const cliente = await clientesService.buscarCliente(favorecido);
    if (!cliente) return { status: 'nao_enviado', motivo: 'cliente_nao_encontrado' };
    const telefone = limparTexto(cliente.telefonePrincipal || cliente.telefone1 || cliente.telefone)
      .replace(/\D+/g, '');
    if (!telefone) return { status: 'nao_enviado', motivo: 'sem_telefone' };
    const mensagem = [
      `📦 Pedido: ${numeroPedido}`,
      `Cliente: ${limparTexto(cliente.nome || cliente.razao_social || cliente.fantasia) || '-'}`,
      `Seu pedido entrou na produção da carrada do dia ${formatarDataCarrada(carrada.data)}`,
      `Descrição da carrada: ${limparTexto(carrada.descricao) || '-'}`
    ].join('\n');

    // A tela antes enviava a mesma mensagem via /api/whatsapp/enviar-pedido,
    // que aplica a funcionalidade pedidos_texto.
    await controleWhatsapp.comFuncionalidade('pedidos_texto', () =>
      whatsapp.enviarMensagem({ telefone, mensagem })
    );
    return { status: 'aceito_pelo_provedor' };
  } catch (error) {
    // Pedido já foi gravado: falha ou resultado incerto no WhatsApp não
    // pode induzir nova tentativa de gravar nem reenviar automaticamente.
    return { status: 'resultado_incerto', motivo: limparTexto(error.message) || 'Erro no aviso WhatsApp' };
  }
}

async function inserirPedido(payload) {
  const baseUrl = getBridgeBaseUrl();

  if (!baseUrl) {
    throw new Error('LEGADO_BRIDGE_URL ou LEGACY_FIREBIRD_API_URL não configurada.');
  }

  const payloadLegado = await prepararPayloadLegado(payload);

  const response = await fetch(`${baseUrl}/api/pedidos-insercao-v2`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payloadLegado)
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data?.detalhe || data?.erro || `Falha HTTP ${response.status}`);
  }

  // O frontend e o MCP solicitam explicitamente o aviso automático;
  // outras integrações que já chamavam este serviço não mudam de comportamento.
  if (payload?.aviso_whatsapp_carrada === true) {
    const carrada = data?.carradaVinculada;
    const numero = limparTexto(data?.pedido?.numero);
    const avisoWhatsappCarrada = carrada?.sucesso === true && numero
      ? await notificarEntradaCarrada({ favorecido: payloadLegado.favorecido, numeroPedido: numero, carrada })
      : { status: 'nao_enviado', motivo: 'carrada_nao_vinculada' };
    return { ...data, avisoWhatsappCarrada };
  }

  return data;
}

module.exports = {
  inserirPedido
};
