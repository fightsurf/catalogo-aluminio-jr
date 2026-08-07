const sharp = require('sharp');
const zapiService = require('../../integracoes/zapi.service');

function numeroSeguro(valor) {
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : 0;
}

function textoSeguro(valor) {
  if (valor === undefined || valor === null) {
    return '';
  }

  return String(valor).trim();
}

function normalizarPedido(item) {
  const total = numeroSeguro(item.total ?? item.TOTAL);
  const totalPago = numeroSeguro(item.totalPago ?? item.total_pago ?? item.TOTAL_PAGO);
  const saldoInformado = item.saldoRestante ?? item.saldo_restante ?? item.SALDO_RESTANTE;
  const saldoRestante = saldoInformado === undefined || saldoInformado === null
    ? Number((total - totalPago).toFixed(2))
    : numeroSeguro(saldoInformado);

  return {
    empresa: item.empresa ?? item.EMPRESA ?? -1,
    saida: item.saida ?? item.SAIDA ?? null,
    pdv: item.pdv ?? item.PDV ?? 0,
    numero: item.numero ?? item.NUMERO ?? null,
    data: item.data ?? item.DATA ?? null,
    total,
    totalPago: Number(totalPago.toFixed(2)),
    saldoRestante: Number(saldoRestante.toFixed(2)),
    favorecido: item.favorecido ?? item.FAVORECIDO ?? null,
    clienteNome: textoSeguro(item.clienteNome ?? item.cliente_nome ?? item.CLIENTE_NOME),
    clienteTelefone1: textoSeguro(item.clienteTelefone1 ?? item.cliente_telefone1 ?? item.CLIENTE_TELEFONE1),
    clienteTelefonePrincipal: textoSeguro(item.clienteTelefonePrincipal ?? item.cliente_telefone_principal ?? item.CLIENTE_TELEFONE_PRINCIPAL),
    carradaCodigo: item.carradaCodigo ?? item.carrada_codigo ?? item.CARRADA_CODIGO ?? null,
    carradaData: item.carradaData ?? item.carrada_data ?? item.CARRADA_DATA ?? null,
    carradaDescricao: textoSeguro(item.carradaDescricao ?? item.carrada_descricao ?? item.CARRADA_DESCRICAO),
    VendedorNome:
      item.VendedorNome ??
      item.VENDEDORNOME ??
      item.vendedornome ??
      ''
  };
}

function normalizarCliente(item, favorecido) {
  return {
    favorecido:
      item?.favorecido ??
      item?.FAVORECIDO ??
      Number(favorecido),
    nome:
      item?.nome ??
      item?.NOME ??
      ''
  };
}

async function listarPedidosPorCliente(favorecido) {
  const baseUrl = process.env.LEGADO_BRIDGE_URL;

  if (!baseUrl) {
    throw new Error('Variável de ambiente LEGADO_BRIDGE_URL não configurada.');
  }

  const url = `${baseUrl.replace(/\/+$/, '')}/api/pedidos-cliente/${favorecido}`;

  const response = await fetch(url);
  let payload = null;

  try {
    payload = await response.json();
  } catch (error) {
    payload = null;
  }

  if (!response.ok) {
    throw new Error(
      payload?.detalhe ||
      payload?.mensagem ||
      `Falha ao consumir bridge local. HTTP ${response.status}`
    );
  }

  const dadosOriginais = Array.isArray(payload?.dados) ? payload.dados : [];
  const clienteOriginal = payload?.cliente || null;

  return {
    cliente: normalizarCliente(clienteOriginal, favorecido),
    dados: dadosOriginais.map(normalizarPedido)
  };
}


function escaparXml(valor) {
  return String(valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function formatarMoedaImagem(valor) {
  return numeroSeguro(valor).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  });
}

function formatarDataImagem(valor) {
  if (!valor) return '-';

  const texto = String(valor);
  const iso = texto.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;

  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) return texto;
  return data.toLocaleDateString('pt-BR');
}

function validarPedidosResumo(pedidos) {
  if (!Array.isArray(pedidos) || pedidos.length === 0) {
    throw new Error('Selecione pelo menos um pedido para enviar o resumo.');
  }

  if (pedidos.length > 150) {
    throw new Error('O resumo aceita no máximo 150 pedidos por imagem.');
  }

  return pedidos.map((pedido) => ({
    numero: textoSeguro(pedido?.numero) || '-',
    data: pedido?.data || null,
    total: numeroSeguro(pedido?.total),
    totalPago: numeroSeguro(pedido?.totalPago),
    saldoRestante: numeroSeguro(pedido?.saldoRestante)
  }));
}

function montarSvgResumo({ clienteNome, pedidos }) {
  const largura = 1200;
  const margem = 56;
  const topoTabela = 390;
  const alturaLinha = 58;
  const altura = topoTabela + 72 + (pedidos.length * alturaLinha) + 76;

  const totais = pedidos.reduce((acc, pedido) => {
    acc.total += pedido.total;
    acc.pago += pedido.totalPago;
    acc.restante += pedido.saldoRestante;
    return acc;
  }, { total: 0, pago: 0, restante: 0 });

  const colunas = {
    pedido: margem + 18,
    data: 300,
    total: 510,
    pago: 760,
    restante: 970
  };

  const linhas = pedidos.map((pedido, index) => {
    const y = topoTabela + 74 + (index * alturaLinha);
    const bg = index % 2 === 0 ? '#ffffff' : '#f8fafc';
    const saldoCor = pedido.saldoRestante < 0 ? '#047857' : pedido.saldoRestante > 0 ? '#b45309' : '#374151';

    return `
      <rect x="${margem}" y="${y}" width="${largura - (margem * 2)}" height="${alturaLinha}" fill="${bg}" />
      <text x="${colunas.pedido}" y="${y + 36}" class="linha forte">${escaparXml(pedido.numero)}</text>
      <text x="${colunas.data}" y="${y + 36}" class="linha">${escaparXml(formatarDataImagem(pedido.data))}</text>
      <text x="${colunas.total}" y="${y + 36}" class="linha forte">${escaparXml(formatarMoedaImagem(pedido.total))}</text>
      <text x="${colunas.pago}" y="${y + 36}" class="linha forte">${escaparXml(formatarMoedaImagem(pedido.totalPago))}</text>
      <text x="${colunas.restante}" y="${y + 36}" class="linha forte" style="fill:${saldoCor}">${escaparXml(formatarMoedaImagem(pedido.saldoRestante))}</text>
    `;
  }).join('');

  const cards = [
    { x: margem, label: 'SOMATÓRIO DOS PEDIDOS', valor: totais.total, cor: '#111827' },
    { x: 420, label: 'TOTAL PAGO', valor: totais.pago, cor: '#111827' },
    { x: 784, label: 'TOTAL RESTANTE', valor: totais.restante, cor: totais.restante < 0 ? '#047857' : totais.restante > 0 ? '#b45309' : '#374151' }
  ].map((card) => `
    <rect x="${card.x}" y="205" width="340" height="132" rx="18" fill="#f8fafc" stroke="#dbe3ee" stroke-width="2" />
    <text x="${card.x + 22}" y="244" class="card-label">${card.label}</text>
    <text x="${card.x + 22}" y="298" class="card-valor" fill="${card.cor}">${escaparXml(formatarMoedaImagem(card.valor))}</text>
  `).join('');

  return `
  <svg xmlns="http://www.w3.org/2000/svg" width="${largura}" height="${altura}" viewBox="0 0 ${largura} ${altura}">
    <rect width="100%" height="100%" fill="#ffffff" />
    <style>
      text { font-family: Arial, Helvetica, sans-serif; }
      .marca { font-size: 25px; font-weight: 800; fill: #2563eb; letter-spacing: .5px; }
      .titulo { font-size: 36px; font-weight: 800; fill: #111827; }
      .cliente { font-size: 23px; font-weight: 700; fill: #374151; }
      .card-label { font-size: 16px; font-weight: 800; fill: #64748b; }
      .card-valor { font-size: 29px; font-weight: 800; }
      .cabecalho { font-size: 17px; font-weight: 800; fill: #374151; }
      .linha { font-size: 18px; fill: #374151; }
      .forte { font-weight: 700; }
      .rodape { font-size: 15px; fill: #64748b; }
    </style>

    <text x="${margem}" y="68" class="marca">ALUMÍNIO JR</text>
    <text x="${margem}" y="122" class="titulo">Resumo dos pedidos selecionados</text>
    <text x="${margem}" y="164" class="cliente">Cliente: ${escaparXml(clienteNome || 'Cliente')}</text>

    ${cards}

    <rect x="${margem}" y="${topoTabela}" width="${largura - (margem * 2)}" height="72" rx="12" fill="#f1f5f9" />
    <text x="${colunas.pedido}" y="${topoTabela + 44}" class="cabecalho">PEDIDO</text>
    <text x="${colunas.data}" y="${topoTabela + 44}" class="cabecalho">DATA</text>
    <text x="${colunas.total}" y="${topoTabela + 44}" class="cabecalho">TOTAL</text>
    <text x="${colunas.pago}" y="${topoTabela + 44}" class="cabecalho">PAGO</text>
    <text x="${colunas.restante}" y="${topoTabela + 44}" class="cabecalho">RESTANTE</text>

    ${linhas}

    <line x1="${margem}" y1="${altura - 48}" x2="${largura - margem}" y2="${altura - 48}" stroke="#e5e7eb" stroke-width="2" />
    <text x="${margem}" y="${altura - 20}" class="rodape">Resumo gerado pelo sistema Alumínio JR</text>
  </svg>`;
}

async function enviarResumoImagemWhatsapp(payload = {}) {
  const telefone = zapiService.normalizarTelefone(payload.telefone);
  const clienteNome = textoSeguro(payload.clienteNome) || 'Cliente';
  const pedidos = validarPedidosResumo(payload.pedidos);

  if (!telefone) {
    throw new Error('Telefone do cliente não encontrado.');
  }

  if (telefone.length < 10) {
    throw new Error('Telefone do cliente inválido para envio pelo WhatsApp.');
  }

  const svg = montarSvgResumo({ clienteNome, pedidos });
  const buffer = await sharp(Buffer.from(svg))
    .jpeg({ quality: 92, chromaSubsampling: '4:4:4' })
    .toBuffer();

  const imagem = `data:image/jpeg;base64,${buffer.toString('base64')}`;
  const legenda = `Resumo dos pedidos selecionados - ${clienteNome}`;
  const envio = await zapiService.enviarImagem({ telefone, imagem, legenda });

  return {
    telefone: envio.telefone || telefone,
    quantidadePedidos: pedidos.length,
    legenda,
    zapi: envio.zapi || envio
  };
}

module.exports = {
  listarPedidosPorCliente,
  enviarResumoImagemWhatsapp
};
