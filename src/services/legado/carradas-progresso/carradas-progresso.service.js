const pool = require('../../../../db/connection');
const carradasService = require('../carradas/carradas.service');
const pagamentosService = require('../pagamentos/pagamentos.service');
const whatsappService = require('../../whatsapp/envio-whatsapp.service');
const carradasStatusResumoService = require('./carradas-status-resumo.service');
const legadoBridgeService = require('../legadoBridge.service');
const pedidosLegadoService = require('../pedido/pedidosLegado.service');
const agenciasRecebimentoService = require('../../logistica/agenciaRecebimentoService');

const FASES_BOOLEANAS = {
  EM_PRODUCAO: {
    nome: 'Em produção',
    enviaWhatsapp: true,
    construirMensagem: ({ numeroPedido, nomeCliente, valorPedido, data }) => [
      `📦 Pedido nº ${numeroPedido}`,
      '',
      `Cliente: ${nomeCliente}`,
      `Valor do pedido: ${formatarMoeda(valorPedido)}`,
      '',
      `Seu pedido entrou em produção em ${data}.`
    ].join('\n')
  },
  PEDIDO_PRONTO: {
    nome: 'Pedido pronto',
    enviaWhatsapp: true,
    construirMensagem: ({ numeroPedido, nomeCliente, valorPedido, data }) => [
      `📦 Pedido nº ${numeroPedido}`,
      '',
      `Cliente: ${nomeCliente}`,
      `Valor do pedido: ${formatarMoeda(valorPedido)}`,
      '',
      `Seu pedido ficou pronto em ${data}.`
    ].join('\n')
  },
  QTDE_VOLUMES: {
    nome: 'Quantidade de volumes',
    enviaWhatsapp: false
  },
  VIDEO_FEITO: {
    nome: 'Vídeo feito',
    enviaWhatsapp: false
  },
  QUER_NOTA_FISCAL: {
    nome: 'Quer nota fiscal',
    enviaWhatsapp: true,
    construirMensagem: () => 'Vai precisar de Nota Fiscal? Preciso calcular os impostos para acrescentar se for querer.'
  },
  LOCAL_ENTREGA: {
    nome: 'Local de entrega',
    enviaWhatsapp: false
  },
  LIGACAO_POS_VENDA: {
    nome: 'Ligação pós-venda',
    enviaWhatsapp: false
  },
  PAGAMENTO_QUITADO: {
    nome: 'Pagamento quitado',
    enviaWhatsapp: false
  }
};

const FASES_MATRIZ = [
  { codigo: 'EM_PRODUCAO', nome: 'Em produção', tipo: 'boolean' },
  { codigo: 'PEDIDO_PRONTO', nome: 'Pedido pronto', tipo: 'boolean' },
  { codigo: 'QTDE_VOLUMES', nome: 'Qtde Vols', tipo: 'volumes' },
  { codigo: 'ETIQUETA_VOLUMES', nome: 'Etiqueta volumes', tipo: 'especial' },
  { codigo: 'VIDEO_FEITO', nome: 'Vídeo feito', tipo: 'boolean' },
  { codigo: 'QUER_NOTA_FISCAL', nome: 'Quer nota fiscal', tipo: 'boolean' },
  { codigo: 'LOCAL_ENTREGA', nome: 'Local de entrega', tipo: 'especial' },
  { codigo: 'PAGAMENTO_QUITADO', nome: 'Pagamento quitado', tipo: 'automatico' },
  { codigo: 'DATA_EXPEDICAO', nome: 'Data de expedição', tipo: 'expedicao' },
  { codigo: 'LIGACAO_POS_VENDA', nome: 'Ligação pós-venda', tipo: 'boolean' }
];

let estruturaRedespachoPromise = null;

function criarErro(message, status = 400) {
  const error = new Error(message);
  error.statusCode = status;
  return error;
}

async function tabelasModuloExistem(client = pool) {
  const result = await client.query(`
    SELECT
      to_regclass('public.carradas_pedidos_fases') AS fases,
      to_regclass('public.clientes_etiquetas_volumes') AS etiquetas_clientes,
      to_regclass('public.carradas_pedidos_etiquetas_volumes') AS etiquetas_pedidos,
      to_regclass('public.carradas_pedidos_local_entrega') AS local_entrega,
      to_regclass('public.carradas_pedidos_fases_notificacoes') AS notificacoes
  `);

  const row = result.rows[0] || {};

  return Boolean(row.fases)
    && Boolean(row.etiquetas_clientes)
    && Boolean(row.etiquetas_pedidos)
    && Boolean(row.local_entrega)
    && Boolean(row.notificacoes);
}

async function garantirTabelasModulo(client = pool) {
  const existem = await tabelasModuloExistem(client);

  if (!existem) {
    throw criarErro(
      'As tabelas do módulo de progresso das carradas ainda não foram criadas no PostgreSQL. Execute o arquivo render/db/sql/20260406_carradas_progresso.sql antes de usar este módulo.',
      500
    );
  }

  await agenciasRecebimentoService.garantirEstruturaAgencias(client);

  if (!estruturaRedespachoPromise) {
    estruturaRedespachoPromise = (async () => {
      await client.query(`
        ALTER TABLE carradas_pedidos_local_entrega
        ADD COLUMN IF NOT EXISTS redespacho_transportadora_id BIGINT REFERENCES transportadoras(id) ON DELETE SET NULL
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_carradas_pedidos_local_entrega_redespacho
        ON carradas_pedidos_local_entrega(redespacho_transportadora_id)
      `);
    })().catch((error) => {
      estruturaRedespachoPromise = null;
      throw error;
    });
  }

  await estruturaRedespachoPromise;
}

function limparTexto(value) {
  return String(value || '').trim();
}

function parseCodigoCarrada(value) {
  const codigo = Number.parseInt(value, 10);

  if (!Number.isInteger(codigo) || codigo <= 0) {
    throw criarErro('Código da carrada inválido.', 400);
  }

  return codigo;
}

function normalizarNumeroPedido(value) {
  const numero = limparTexto(value);

  if (!numero) {
    throw criarErro('Número do pedido inválido.', 400);
  }

  return numero;
}

function normalizarBoolean(value) {
  if (typeof value === 'boolean') {
    return value;
  }

  if (value === 'true' || value === '1' || value === 1) {
    return true;
  }

  if (value === 'false' || value === '0' || value === 0) {
    return false;
  }

  throw criarErro('Valor booleano inválido.', 400);
}

function normalizarQuantidadeVolumes(value) {
  const texto = String(value ?? '').trim();

  if (!/^\d+$/.test(texto)) {
    throw criarErro('Informe uma quantidade de volumes inteira e não negativa.', 400);
  }

  const quantidade = Number.parseInt(texto, 10);

  if (!Number.isSafeInteger(quantidade) || quantidade < 0) {
    throw criarErro('Informe uma quantidade de volumes inteira e não negativa.', 400);
  }

  return quantidade;
}

function formatarMoeda(value) {
  return Number(value || 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  });
}

function formatarDataBR(value) {
  if (!value) {
    return '';
  }

  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleDateString('pt-BR');
}

function dataHojeFortalezaBR() {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Fortaleza',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  }).format(new Date());
}

function normalizarDataExpedicao(value) {
  const texto = limparTexto(value);

  if (!texto) {
    return '';
  }

  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(texto)) {
    throw criarErro('Informe a data de expedição no formato DD/MM/AAAA.', 400);
  }

  const [dia, mes, ano] = texto.split('/').map(Number);
  const data = new Date(ano, mes - 1, dia);

  if (
    data.getFullYear() !== ano
    || data.getMonth() !== mes - 1
    || data.getDate() !== dia
  ) {
    throw criarErro('Informe uma data de expedição válida.', 400);
  }

  return `${String(dia).padStart(2, '0')}/${String(mes).padStart(2, '0')}/${String(ano).padStart(4, '0')}`;
}

function formatarDataHoraBR(value) {
  if (!value) {
    return '';
  }

  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleString('pt-BR');
}

function calcularQuantidadeItens(itens) {
  return (Array.isArray(itens) ? itens : []).reduce((acc, item) => acc + Number(item?.quantidade || 0), 0);
}

function calcularPagamentoQuitado(detalhePagamento) {
  const saldo = Number(detalhePagamento?.resumo?.saldoRestante ?? 0);
  return saldo <= 0.009;
}

function normalizarTelefonePedido(detalhePagamento) {
  return limparTexto(
    detalhePagamento?.pedido?.cliente?.telefonePrincipal
      || detalhePagamento?.pedido?.cliente?.telefone1
  );
}

function normalizarTelefoneLote(pedido, detalhePagamento) {
  return limparTexto(
    detalhePagamento?.pedido?.cliente?.telefonePrincipal
      || detalhePagamento?.pedido?.cliente?.telefone1
      || pedido?.cliente?.telefonePrincipal
      || pedido?.cliente?.telefone1
  );
}

function montarMensagemWhatsappCarradaPedido({ pedido, carrada, mensagemPersonalizada }) {
  const nomeCliente = limparTexto(pedido?.cliente?.nome) || '-';
  const numeroPedido = limparTexto(pedido?.numero) || '-';
  const dataCarrada = formatarDataBR(carrada?.data) || '-';
  const descricaoCarrada = limparTexto(carrada?.descricao) || 'Sem descrição';
  const mensagemLivre = limparTexto(mensagemPersonalizada);

  return [
    'MENSAGEM AUTOMÁTICA - ALUMÍNIO JR',
    `Nome cliente: ${nomeCliente}`,
    `Número pedido: ${numeroPedido}`,
    `Carrada: ${dataCarrada} - ${descricaoCarrada}`,
    '',
    mensagemLivre
  ].join('\n');
}

function encontrarPedidoNaCarrada(carrada, numeroPedido) {
  const pedido = (Array.isArray(carrada?.pedidos) ? carrada.pedidos : []).find(
    (item) => String(item?.numero) === String(numeroPedido)
  );

  if (!pedido) {
    throw criarErro(`O pedido ${numeroPedido} não pertence à carrada ${carrada?.codigo || ''}.`, 404);
  }

  return pedido;
}

function normalizarSaida(value) {
  const saida = Number.parseInt(value, 10);
  return Number.isInteger(saida) && saida > 0 ? saida : null;
}

function criarChavePedido({ saida, numero }) {
  const saidaNormalizada = normalizarSaida(saida);

  if (saidaNormalizada !== null) {
    return `saida:${saidaNormalizada}`;
  }

  const numeroNormalizado = limparTexto(numero);
  return numeroNormalizado ? `numero:${numeroNormalizado}` : '';
}

function criarIndicePedidos(pedidosParam = []) {
  const pedidos = Array.isArray(pedidosParam) ? pedidosParam : [];
  const porChave = new Map();
  const porSaida = new Map();
  const porNumero = new Map();
  const saidas = [];
  const numeros = [];

  pedidos.forEach((pedido) => {
    const numero = limparTexto(pedido?.numero);
    const saida = normalizarSaida(pedido?.saida);
    const chave = criarChavePedido({ saida, numero });

    if (!chave) {
      return;
    }

    porChave.set(chave, pedido);

    if (saida !== null) {
      porSaida.set(saida, chave);
      saidas.push(saida);
    }

    if (numero) {
      porNumero.set(numero, chave);
      numeros.push(numero);
    }
  });

  return {
    porChave,
    porSaida,
    porNumero,
    saidas: [...new Set(saidas)],
    numeros: [...new Set(numeros)]
  };
}

function obterChavePedidoNoIndice(row, indicePedidos) {
  const saida = normalizarSaida(row?.saida);

  if (saida !== null) {
    return indicePedidos.porSaida.get(saida) || '';
  }

  const numero = limparTexto(row?.numero_pedido || row?.numeroPedido || row?.numero);
  return numero ? indicePedidos.porNumero.get(numero) || '' : '';
}

function obterIdentificadoresPedido(pedido, numeroPedidoParam) {
  return {
    saida: normalizarSaida(pedido?.saida),
    numero: normalizarNumeroPedido(numeroPedidoParam || pedido?.numero)
  };
}

function montarCondicaoPedidoPorSaidaOuNumero(alias = '') {
  const prefixo = alias ? `${alias}.` : '';

  return `(
    (${prefixo}saida IS NOT NULL AND ${prefixo}saida = $1::bigint)
    OR (${prefixo}saida IS NULL AND ${prefixo}numero_pedido = $2)
    OR ($1::bigint IS NULL AND ${prefixo}numero_pedido = $2)
  )`;
}

function linhaMaisNovaQueAtual(novaLinha, linhaAtual) {
  if (!linhaAtual) {
    return true;
  }

  const novaData = new Date(novaLinha?.updated_at || novaLinha?.updatedAt || novaLinha?.created_at || novaLinha?.createdAt || 0).getTime();
  const atualData = new Date(linhaAtual?.updated_at || linhaAtual?.updatedAt || linhaAtual?.created_at || linhaAtual?.createdAt || 0).getTime();

  return novaData >= atualData;
}

async function buscarUltimaFaseBooleanaPorPedido({ saida, numeroPedido, faseCodigo }) {
  const result = await pool.query(
    `
      SELECT codigo_carrada, numero_pedido, saida, fase_codigo, valor_boolean, created_at, updated_at
      FROM carradas_pedidos_fases
      WHERE fase_codigo = $3
        AND ${montarCondicaoPedidoPorSaidaOuNumero()}
      ORDER BY COALESCE(updated_at, created_at) DESC, codigo_carrada DESC
      LIMIT 1
    `,
    [saida, numeroPedido, faseCodigo]
  );

  return result.rows[0] || null;
}

async function sincronizarFaseBooleanaPorPedido({ codigoCarrada, numeroPedido, saida, faseCodigo, valorBoolean }) {
  await pool.query(
    `
      UPDATE carradas_pedidos_fases
      SET valor_boolean = $4,
          updated_at = NOW()
      WHERE fase_codigo = $3
        AND ${montarCondicaoPedidoPorSaidaOuNumero()}
    `,
    [saida, numeroPedido, faseCodigo, valorBoolean]
  );

  const result = await pool.query(
    `
      INSERT INTO carradas_pedidos_fases (
        codigo_carrada,
        numero_pedido,
        saida,
        fase_codigo,
        valor_boolean
      ) VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (codigo_carrada, numero_pedido, fase_codigo)
      DO UPDATE SET
        saida = EXCLUDED.saida,
        valor_boolean = EXCLUDED.valor_boolean,
        updated_at = NOW()
      RETURNING codigo_carrada, numero_pedido, saida, fase_codigo, valor_boolean, created_at, updated_at
    `,
    [codigoCarrada, numeroPedido, saida, faseCodigo, valorBoolean]
  );

  return result.rows[0] || null;
}

async function excluirFaseBooleanaPorPedido({ saida, numeroPedido, faseCodigo }) {
  await pool.query(
    `
      DELETE FROM carradas_pedidos_fases
      WHERE fase_codigo = $3
        AND ${montarCondicaoPedidoPorSaidaOuNumero()}
    `,
    [saida, numeroPedido, faseCodigo]
  );
}

async function buscarCarradaOuFalhar(codigoCarrada) {
  const carrada = await carradasService.buscarCarrada(codigoCarrada);

  if (!carrada) {
    throw criarErro('Carrada não encontrada.', 404);
  }

  return carrada;
}

async function buscarDetalhePagamentoDoPedido(pedido) {
  if (!pedido?.saida) {
    return null;
  }

  try {
    return await pagamentosService.buscarPedidoComPagamentos({
      empresa: pedido.empresa ?? -1,
      saida: pedido.saida,
      pdv: pedido.pdv ?? 0
    });
  } catch (error) {
    return null;
  }
}

function montarResumoPedido(pedido, detalhePagamento = null) {
  const resumoPagamento = detalhePagamento?.resumo || {};
  const clientePagamento = detalhePagamento?.pedido?.cliente || {};

  return {
    numeroPedido: pedido?.numero || '',
    data: pedido?.data || null,
    cliente: {
      favorecido: pedido?.cliente?.favorecido ?? null,
      nome: clientePagamento.nome || pedido?.cliente?.nome || '',
      cidade: clientePagamento.cidade || pedido?.cliente?.cidade || '',
      uf: clientePagamento.uf || pedido?.cliente?.uf || '',
      telefonePrincipal: clientePagamento.telefonePrincipal || clientePagamento.telefone1 || ''
    },
    valorPedido: Number(detalhePagamento?.pedido?.total ?? pedido?.total ?? 0),
    totalPago: Number(resumoPagamento.totalPago ?? 0),
    saldoRestante: Number(resumoPagamento.saldoRestante ?? 0),
    quantidadeTiposItens: Array.isArray(pedido?.itens) ? pedido.itens.length : 0,
    quantidadeItens: calcularQuantidadeItens(pedido?.itens),
    itens: Array.isArray(pedido?.itens) ? pedido.itens : []
  };
}

async function registrarNotificacao(payload) {
  const faseCodigo = limparTexto(payload?.faseCodigo).toUpperCase();
  const codigoCarrada = parseCodigoCarrada(payload?.codigoCarrada);
  const numeroPedido = normalizarNumeroPedido(payload?.numeroPedido);

  await pool.query(
    `
      INSERT INTO carradas_pedidos_fases_notificacoes (
        fase_codigo,
        codigo_carrada,
        numero_pedido,
        telefone,
        mensagem,
        status_envio,
        resposta_api
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    `,
    [
      faseCodigo,
      codigoCarrada,
      numeroPedido,
      limparTexto(payload?.telefone) || null,
      limparTexto(payload?.mensagem),
      limparTexto(payload?.statusEnvio) || 'erro',
      payload?.respostaApi ? payload.respostaApi : null
    ]
  );
}

async function buscarBooleanRowsDosPedidos(pedidos = []) {
  const indicePedidos = criarIndicePedidos(pedidos);
  const mapa = new Map();

  if (!indicePedidos.saidas.length && !indicePedidos.numeros.length) {
    return mapa;
  }

  const result = await pool.query(
    `
      SELECT codigo_carrada, numero_pedido, saida, fase_codigo, valor_boolean, created_at, updated_at
      FROM carradas_pedidos_fases
      WHERE (saida IS NOT NULL AND saida = ANY($1::bigint[]))
         OR numero_pedido = ANY($2::text[])
      ORDER BY COALESCE(updated_at, created_at) ASC, codigo_carrada ASC
    `,
    [indicePedidos.saidas, indicePedidos.numeros]
  );

  result.rows.forEach((row) => {
    const chavePedido = obterChavePedidoNoIndice(row, indicePedidos);

    if (!chavePedido) {
      return;
    }

    if (!mapa.has(chavePedido)) {
      mapa.set(chavePedido, {});
    }

    mapa.get(chavePedido)[String(row.fase_codigo).toUpperCase()] = {
      valorBoolean: Boolean(row.valor_boolean),
      codigoCarrada: row.codigo_carrada ?? null,
      numeroPedido: row.numero_pedido || '',
      saida: row.saida ?? null,
      createdAt: row.created_at || null,
      updatedAt: row.updated_at || null
    };
  });

  return mapa;
}

async function buscarEtiquetasRowsDosPedidos(pedidos = []) {
  const indicePedidos = criarIndicePedidos(pedidos);
  const mapa = new Map();

  if (!indicePedidos.saidas.length && !indicePedidos.numeros.length) {
    return mapa;
  }

  const result = await pool.query(
    `
      SELECT
        p.codigo_carrada,
        p.numero_pedido,
        p.saida,
        p.etiqueta_cliente_id,
        p.texto_snapshot,
        p.confirmado_boolean,
        p.enviado_em,
        p.confirmado_em,
        p.created_at,
        p.updated_at,
        c.favorecido,
        c.apelido,
        c.texto_etiqueta,
        c.ativo
      FROM carradas_pedidos_etiquetas_volumes p
      INNER JOIN clientes_etiquetas_volumes c ON c.id = p.etiqueta_cliente_id
      WHERE (p.saida IS NOT NULL AND p.saida = ANY($1::bigint[]))
         OR p.numero_pedido = ANY($2::text[])
      ORDER BY COALESCE(p.updated_at, p.created_at) ASC, p.codigo_carrada ASC
    `,
    [indicePedidos.saidas, indicePedidos.numeros]
  );

  result.rows.forEach((row) => {
    const chavePedido = obterChavePedidoNoIndice(row, indicePedidos);

    if (!chavePedido || !linhaMaisNovaQueAtual(row, mapa.get(chavePedido))) {
      return;
    }

    mapa.set(chavePedido, {
      codigoCarrada: row.codigo_carrada,
      numeroPedido: row.numero_pedido,
      saida: row.saida,
      etiquetaClienteId: row.etiqueta_cliente_id,
      favorecido: row.favorecido,
      apelido: row.apelido,
      textoSnapshot: row.texto_snapshot,
      textoEtiqueta: row.texto_etiqueta,
      ativo: row.ativo,
      confirmadoBoolean: Boolean(row.confirmado_boolean),
      enviadoEm: row.enviado_em,
      confirmadoEm: row.confirmado_em,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    });
  });

  return mapa;
}

async function buscarLocalEntregaRowsDosPedidos(pedidos = []) {
  const indicePedidos = criarIndicePedidos(pedidos);
  const mapa = new Map();

  if (!indicePedidos.saidas.length && !indicePedidos.numeros.length) {
    return mapa;
  }

  const result = await pool.query(
    `
      SELECT
        le.codigo_carrada,
        le.numero_pedido,
        le.saida,
        le.transportadora_id,
        le.redespacho_transportadora_id,
        le.agencia_recebimento_codigo,
        le.agencia_cidade,
        le.created_at,
        le.updated_at,
        t.nome AS transportadora_nome,
        t.telefone_principal AS transportadora_telefone_principal,
        r.nome AS redespacho_transportadora_nome,
        r.telefone_principal AS redespacho_transportadora_telefone_principal,
        a.nome AS agencia_recebimento_nome,
        a.cidade_id AS agencia_recebimento_cidade_id,
        ac.nome AS agencia_recebimento_cidade_nome,
        ac.estado AS agencia_recebimento_cidade_estado
      FROM carradas_pedidos_local_entrega le
      INNER JOIN transportadoras t ON t.id = le.transportadora_id
      LEFT JOIN transportadoras r ON r.id = le.redespacho_transportadora_id
      LEFT JOIN agencias_recebimento a ON a.codigo = le.agencia_recebimento_codigo
      LEFT JOIN cidades ac ON ac.id = a.cidade_id
      WHERE (le.saida IS NOT NULL AND le.saida = ANY($1::bigint[]))
         OR le.numero_pedido = ANY($2::text[])
      ORDER BY COALESCE(le.updated_at, le.created_at) ASC, le.codigo_carrada ASC
    `,
    [indicePedidos.saidas, indicePedidos.numeros]
  );

  result.rows.forEach((row) => {
    const chavePedido = obterChavePedidoNoIndice(row, indicePedidos);

    if (!chavePedido || !linhaMaisNovaQueAtual(row, mapa.get(chavePedido))) {
      return;
    }

    mapa.set(chavePedido, {
      codigoCarrada: row.codigo_carrada,
      numeroPedido: row.numero_pedido,
      saida: row.saida,
      transportadoraId: row.transportadora_id,
      transportadoraNome: row.transportadora_nome || '',
      transportadoraTelefonePrincipal: row.transportadora_telefone_principal || '',
      redespachoTransportadoraId: row.redespacho_transportadora_id || null,
      redespachoTransportadoraNome: row.redespacho_transportadora_nome || '',
      redespachoTransportadoraTelefonePrincipal: row.redespacho_transportadora_telefone_principal || '',
      agenciaRecebimentoCodigo: row.agencia_recebimento_codigo || null,
      agenciaRecebimentoNome: row.agencia_recebimento_nome || row.agencia_cidade || '',
      agenciaRecebimentoCidadeId: row.agencia_recebimento_cidade_id || null,
      agenciaRecebimentoCidadeNome: row.agencia_recebimento_cidade_nome || '',
      agenciaRecebimentoCidadeUf: row.agencia_recebimento_cidade_estado || '',
      agenciaCidade: row.agencia_cidade || row.agencia_recebimento_nome || '',
      createdAt: row.created_at,
      updatedAt: row.updated_at
    });
  });

  return mapa;
}

function montarFasesDoPedido({ pedido, booleanRows = {}, etiquetaRow = null, localEntregaRow = null, detalhePagamento = null }) {
  const faseEmProducao = Boolean(booleanRows.EM_PRODUCAO?.valorBoolean);
  const fasePedidoPronto = Boolean(booleanRows.PEDIDO_PRONTO?.valorBoolean);
  const faseQtdeVolumes = Boolean(booleanRows.QTDE_VOLUMES?.valorBoolean);
  const quantidadeVolumesBruta = Number(pedido?.qtdeVolume ?? pedido?.volumes ?? 0);
  const quantidadeVolumes = Number.isFinite(quantidadeVolumesBruta) && quantidadeVolumesBruta >= 0
    ? Math.trunc(quantidadeVolumesBruta)
    : 0;
  const qtdeVolumesCalculada = Boolean(booleanRows.QTDE_VOLUMES) || quantidadeVolumes > 0;
  const faseVideoFeito = Boolean(booleanRows.VIDEO_FEITO?.valorBoolean);
  const faseQuerNotaFiscal = Boolean(booleanRows.QUER_NOTA_FISCAL?.valorBoolean);
  const faseLocalEntregaSilencioso = Boolean(booleanRows.LOCAL_ENTREGA?.valorBoolean);
  const faseLigacaoPosVenda = Boolean(booleanRows.LIGACAO_POS_VENDA?.valorBoolean);
  const etiquetaSilenciosa = Boolean(booleanRows.ETIQUETA_VOLUMES?.valorBoolean);
  const etiquetaConfirmada = Boolean(etiquetaRow?.confirmadoBoolean) || etiquetaSilenciosa;
  const localEntregaDefinido = Boolean(localEntregaRow?.transportadoraId) || faseLocalEntregaSilencioso;
  const pagamentoQuitadoAutomatico = calcularPagamentoQuitado(detalhePagamento);
  const pagamentoMarcadoManual = Boolean(booleanRows.PAGAMENTO_QUITADO?.valorBoolean);
  const pagamentoQuitado = pagamentoQuitadoAutomatico || pagamentoMarcadoManual;
  const dataExpedicao = limparTexto(pedido?.dataExpedicao);

  return {
    EM_PRODUCAO: {
      codigo: 'EM_PRODUCAO',
      concluido: faseEmProducao,
      tipo: 'boolean',
      updatedAt: booleanRows.EM_PRODUCAO?.updatedAt || null
    },
    PEDIDO_PRONTO: {
      codigo: 'PEDIDO_PRONTO',
      concluido: fasePedidoPronto,
      tipo: 'boolean',
      updatedAt: booleanRows.PEDIDO_PRONTO?.updatedAt || null
    },
    QTDE_VOLUMES: {
      codigo: 'QTDE_VOLUMES',
      concluido: faseQtdeVolumes,
      tipo: 'volumes',
      quantidade: quantidadeVolumes,
      calculadoAutomaticamente: !faseQtdeVolumes && qtdeVolumesCalculada,
      updatedAt: booleanRows.QTDE_VOLUMES?.updatedAt || null
    },
    ETIQUETA_VOLUMES: {
      codigo: 'ETIQUETA_VOLUMES',
      concluido: etiquetaConfirmada,
      tipo: 'especial',
      etiquetaClienteId: etiquetaRow?.etiquetaClienteId || null,
      apelido: etiquetaRow?.apelido || '',
      textoSnapshot: etiquetaRow?.textoSnapshot || '',
      enviadoEm: etiquetaRow?.enviadoEm || null,
      confirmadoEm: etiquetaRow?.confirmadoEm || (etiquetaSilenciosa ? booleanRows.ETIQUETA_VOLUMES?.updatedAt || null : null)
    },
    VIDEO_FEITO: {
      codigo: 'VIDEO_FEITO',
      concluido: faseVideoFeito,
      tipo: 'boolean',
      updatedAt: booleanRows.VIDEO_FEITO?.updatedAt || null
    },
    QUER_NOTA_FISCAL: {
      codigo: 'QUER_NOTA_FISCAL',
      concluido: faseQuerNotaFiscal,
      tipo: 'boolean',
      updatedAt: booleanRows.QUER_NOTA_FISCAL?.updatedAt || null
    },
    LOCAL_ENTREGA: {
      codigo: 'LOCAL_ENTREGA',
      concluido: localEntregaDefinido,
      tipo: 'especial',
      transportadoraId: localEntregaRow?.transportadoraId || null,
      transportadoraNome: localEntregaRow?.transportadoraNome || '',
      redespachoTransportadoraId: localEntregaRow?.redespachoTransportadoraId || null,
      redespachoTransportadoraNome: localEntregaRow?.redespachoTransportadoraNome || '',
      agenciaRecebimentoCodigo: localEntregaRow?.agenciaRecebimentoCodigo || null,
      agenciaRecebimentoNome: localEntregaRow?.agenciaRecebimentoNome || localEntregaRow?.agenciaCidade || '',
      agenciaRecebimentoCidadeId: localEntregaRow?.agenciaRecebimentoCidadeId || null,
      agenciaRecebimentoCidadeNome: localEntregaRow?.agenciaRecebimentoCidadeNome || '',
      agenciaRecebimentoCidadeUf: localEntregaRow?.agenciaRecebimentoCidadeUf || '',
      agenciaCidade: localEntregaRow?.agenciaCidade || localEntregaRow?.agenciaRecebimentoNome || '',
      marcadoSilencioso: faseLocalEntregaSilencioso,
      updatedAt: localEntregaRow?.updatedAt || booleanRows.LOCAL_ENTREGA?.updatedAt || null
    },
    PAGAMENTO_QUITADO: {
      codigo: 'PAGAMENTO_QUITADO',
      concluido: pagamentoQuitado,
      tipo: 'automatico',
      marcadoManual: pagamentoMarcadoManual,
      automaticoQuitado: pagamentoQuitadoAutomatico,
      updatedAt: booleanRows.PAGAMENTO_QUITADO?.updatedAt || null,
      totalPago: Number(detalhePagamento?.resumo?.totalPago ?? 0),
      saldoRestante: Number(detalhePagamento?.resumo?.saldoRestante ?? 0),
      saldoRestanteReal: Number(detalhePagamento?.resumo?.saldoRestanteReal ?? detalhePagamento?.resumo?.saldoRestante ?? 0),
      baixadoParaCredito: Boolean(detalhePagamento?.resumo?.baixadoParaCredito),
      valorBaixadoParaCredito: Number(detalhePagamento?.resumo?.valorBaixadoParaCredito ?? 0),
      statusFinanceiroLabel: detalhePagamento?.resumo?.statusFinanceiroLabel || ''
    },
    DATA_EXPEDICAO: {
      codigo: 'DATA_EXPEDICAO',
      concluido: Boolean(dataExpedicao),
      tipo: 'expedicao',
      dataExpedicao
    },
    LIGACAO_POS_VENDA: {
      codigo: 'LIGACAO_POS_VENDA',
      concluido: faseLigacaoPosVenda,
      tipo: 'boolean',
      updatedAt: booleanRows.LIGACAO_POS_VENDA?.updatedAt || null
    }
  };
}

async function buscarMatriz(codigoCarradaParam) {
  await garantirTabelasModulo();

  const codigoCarrada = parseCodigoCarrada(codigoCarradaParam);
  const carrada = await carradasService.buscarResumoCarrada(codigoCarrada);

  if (!carrada) {
    throw criarErro('Carrada não encontrada.', 404);
  }
  const pedidos = Array.isArray(carrada?.pedidos) ? carrada.pedidos : [];

  const [booleanRowsMap, etiquetasMap, localEntregaMap] = await Promise.all([
    buscarBooleanRowsDosPedidos(pedidos),
    buscarEtiquetasRowsDosPedidos(pedidos),
    buscarLocalEntregaRowsDosPedidos(pedidos)
  ]);

  const pagamentoEntries = await Promise.all(
    pedidos.map(async (pedido) => [String(pedido.numero), await buscarDetalhePagamentoDoPedido(pedido)])
  );
  const pagamentoMap = new Map(pagamentoEntries);

  const linhas = pedidos.map((pedido) => {
    const numeroPedido = String(pedido.numero);
    const chavePedido = criarChavePedido({ saida: pedido.saida, numero: numeroPedido });
    const detalhePagamento = pagamentoMap.get(numeroPedido) || null;
    const resumoPedido = montarResumoPedido(pedido, detalhePagamento);
    const fases = montarFasesDoPedido({
      pedido,
      booleanRows: booleanRowsMap.get(chavePedido) || {},
      etiquetaRow: etiquetasMap.get(chavePedido) || null,
      localEntregaRow: localEntregaMap.get(chavePedido) || null,
      detalhePagamento
    });

    return {
      numero: numeroPedido,
      saida: pedido.saida ?? null,
      empresa: pedido.empresa ?? -1,
      pdv: pedido.pdv ?? 0,
      data: pedido.data || null,
      total: Number(pedido.total ?? 0),
      cliente: {
        favorecido: pedido?.cliente?.favorecido ?? null,
        nome: pedido?.cliente?.nome || '',
        cidade: pedido?.cliente?.cidade || '',
        uf: pedido?.cliente?.uf || ''
      },
      resumoPedido,
      fases
    };
  });

  const totaisFases = FASES_MATRIZ.reduce((acc, fase) => {
    acc[fase.codigo] = {
      codigo: fase.codigo,
      nome: fase.nome,
      concluidos: linhas.filter((linha) => Boolean(linha?.fases?.[fase.codigo]?.concluido)).length,
      total: linhas.length
    };
    return acc;
  }, {});

  const fasesSemLigacao = FASES_MATRIZ.filter((fase) => fase.codigo !== 'LIGACAO_POS_VENDA');
  const semicompleta = linhas.length > 0 && linhas.every((linha) => (
    fasesSemLigacao.every((fase) => Boolean(linha?.fases?.[fase.codigo]?.concluido))
  ));
  const concluida = semicompleta && linhas.every((linha) => Boolean(linha?.fases?.LIGACAO_POS_VENDA?.concluido));
  const statusLinha = concluida ? 'completa' : (semicompleta ? 'semicompleta' : 'incompleta');

  await carradasStatusResumoService.salvarStatusLinha(codigoCarrada, statusLinha);

  return {
    carrada: {
      codigo: carrada.codigo,
      data: carrada.data || null,
      descricao: carrada.descricao || '',
      totalPedidos: linhas.length,
      totalItens: linhas.reduce((acc, linha) => acc + Number(linha?.resumoPedido?.quantidadeItens || 0), 0),
      totalValorPedidos: linhas.reduce((acc, linha) => acc + Number(linha?.total || 0), 0)
    },
    fases: FASES_MATRIZ,
    pedidos: linhas,
    totaisFases
  };
}


function calcularResumoConclusaoDaMatriz(matriz) {
  const pedidos = Array.isArray(matriz?.pedidos) ? matriz.pedidos : [];
  const fases = Array.isArray(matriz?.fases) ? matriz.fases : [];

  const totalCelulas = pedidos.length * fases.length;

  if (!totalCelulas) {
    return {
      totalPedidos: pedidos.length,
      totalFases: fases.length,
      totalCelulas,
      celulasConcluidas: 0,
      percentualConclusao: 0,
      concluida: false
    };
  }

  const celulasConcluidas = pedidos.reduce((acc, pedido) => {
    return acc + fases.reduce((subtotal, fase) => {
      return subtotal + (pedido?.fases?.[fase.codigo]?.concluido ? 1 : 0);
    }, 0);
  }, 0);

  const percentualConclusao = Number(((celulasConcluidas / totalCelulas) * 100).toFixed(2));

  return {
    totalPedidos: pedidos.length,
    totalFases: fases.length,
    totalCelulas,
    celulasConcluidas,
    percentualConclusao,
    concluida: celulasConcluidas === totalCelulas
  };
}

const FASES_BOOLEANAS_CODIGOS = Object.keys(FASES_BOOLEANAS);

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


async function buscarResumoBooleanosConcluidosDosPedidos(pedidos = []) {
  const indicePedidos = criarIndicePedidos(pedidos);
  const mapa = new Map();

  if (!indicePedidos.saidas.length && !indicePedidos.numeros.length) {
    return mapa;
  }

  const result = await pool.query(
    `
      SELECT numero_pedido, saida, fase_codigo, valor_boolean, created_at, updated_at
      FROM carradas_pedidos_fases
      WHERE fase_codigo = ANY($3::text[])
        AND ((saida IS NOT NULL AND saida = ANY($1::bigint[])) OR numero_pedido = ANY($2::text[]))
      ORDER BY COALESCE(updated_at, created_at) ASC
    `,
    [indicePedidos.saidas, indicePedidos.numeros, FASES_BOOLEANAS_CODIGOS]
  );

  result.rows.forEach((row) => {
    const chavePedido = obterChavePedidoNoIndice(row, indicePedidos);
    const faseCodigo = String(row.fase_codigo || '').toUpperCase();

    if (!chavePedido || !faseCodigo) {
      return;
    }

    if (!mapa.has(chavePedido)) {
      mapa.set(chavePedido, new Map());
    }

    mapa.get(chavePedido).set(faseCodigo, Boolean(row.valor_boolean));
  });

  const resultado = new Map();

  mapa.forEach((fasesMap, chavePedido) => {
    const concluidas = new Set();

    fasesMap.forEach((valorBoolean, faseCodigo) => {
      if (valorBoolean) {
        concluidas.add(faseCodigo);
      }
    });

    resultado.set(chavePedido, concluidas);
  });

  return resultado;
}

async function buscarResumoEtiquetasConfirmadasDosPedidos(pedidos = []) {
  const indicePedidos = criarIndicePedidos(pedidos);
  const mapa = new Map();

  if (!indicePedidos.saidas.length && !indicePedidos.numeros.length) {
    return new Set();
  }

  const [etiquetasResult, silenciosoResult] = await Promise.all([
    pool.query(
      `
        SELECT numero_pedido, saida, confirmado_boolean, created_at, updated_at
        FROM carradas_pedidos_etiquetas_volumes
        WHERE (saida IS NOT NULL AND saida = ANY($1::bigint[]))
           OR numero_pedido = ANY($2::text[])
        ORDER BY COALESCE(updated_at, created_at) ASC
      `,
      [indicePedidos.saidas, indicePedidos.numeros]
    ),
    pool.query(
      `
        SELECT numero_pedido, saida, valor_boolean AS confirmado_boolean, created_at, updated_at
        FROM carradas_pedidos_fases
        WHERE fase_codigo = 'ETIQUETA_VOLUMES'
          AND ((saida IS NOT NULL AND saida = ANY($1::bigint[])) OR numero_pedido = ANY($2::text[]))
        ORDER BY COALESCE(updated_at, created_at) ASC
      `,
      [indicePedidos.saidas, indicePedidos.numeros]
    )
  ]);

  [...etiquetasResult.rows, ...silenciosoResult.rows].forEach((row) => {
    const chavePedido = obterChavePedidoNoIndice(row, indicePedidos);

    if (!chavePedido || !linhaMaisNovaQueAtual(row, mapa.get(chavePedido))) {
      return;
    }

    mapa.set(chavePedido, row);
  });

  return new Set(
    [...mapa.entries()]
      .filter(([, row]) => Boolean(row.confirmado_boolean))
      .map(([chavePedido]) => chavePedido)
  );
}

async function buscarResumoLocalEntregaDosPedidos(pedidos = []) {
  const indicePedidos = criarIndicePedidos(pedidos);
  const mapa = new Map();

  if (!indicePedidos.saidas.length && !indicePedidos.numeros.length) {
    return new Set();
  }

  const [localEntregaResult, silenciosoResult] = await Promise.all([
    pool.query(
      `
        SELECT numero_pedido, saida, TRUE AS concluido, created_at, updated_at
        FROM carradas_pedidos_local_entrega
        WHERE transportadora_id IS NOT NULL
          AND ((saida IS NOT NULL AND saida = ANY($1::bigint[])) OR numero_pedido = ANY($2::text[]))
        ORDER BY COALESCE(updated_at, created_at) ASC
      `,
      [indicePedidos.saidas, indicePedidos.numeros]
    ),
    pool.query(
      `
        SELECT numero_pedido, saida, valor_boolean AS concluido, created_at, updated_at
        FROM carradas_pedidos_fases
        WHERE fase_codigo = 'LOCAL_ENTREGA'
          AND ((saida IS NOT NULL AND saida = ANY($1::bigint[])) OR numero_pedido = ANY($2::text[]))
        ORDER BY COALESCE(updated_at, created_at) ASC
      `,
      [indicePedidos.saidas, indicePedidos.numeros]
    )
  ]);

  [...localEntregaResult.rows, ...silenciosoResult.rows].forEach((row) => {
    const chavePedido = obterChavePedidoNoIndice(row, indicePedidos);

    if (!chavePedido || !linhaMaisNovaQueAtual(row, mapa.get(chavePedido))) {
      return;
    }

    mapa.set(chavePedido, row);
  });

  return new Set(
    [...mapa.entries()]
      .filter(([, row]) => Boolean(row.concluido))
      .map(([chavePedido]) => chavePedido)
  );
}

async function calcularResumoRapidoCarrada(codigoCarrada) {
  const carrada = await carradasService.buscarResumoCarrada(codigoCarrada);

  if (!carrada) {
    throw criarErro('Carrada não encontrada.', 404);
  }
  const pedidos = Array.isArray(carrada?.pedidos) ? carrada.pedidos : [];
  const totalPedidos = pedidos.length;
  const totalFases = FASES_MATRIZ.length;
  const totalCelulas = totalPedidos * totalFases;

  if (!totalPedidos) {
    return {
      codigoCarrada,
      concluida: false,
      semicompleta: false,
      statusLinha: 'incompleta',
      percentualConclusao: 0,
      totalPedidos,
      totalFases,
      totalCelulas,
      celulasConcluidas: 0
    };
  }

  const [booleanMap, etiquetasSet, localEntregaSet] = await Promise.all([
    buscarResumoBooleanosConcluidosDosPedidos(pedidos),
    buscarResumoEtiquetasConfirmadasDosPedidos(pedidos),
    buscarResumoLocalEntregaDosPedidos(pedidos)
  ]);

  const resumosPedidos = await mapearComConcorrencia(pedidos, 6, async (pedido) => {
    const numeroPedido = String(pedido?.numero || '');
    const chavePedido = criarChavePedido({ saida: pedido?.saida, numero: numeroPedido });
    const booleanSet = booleanMap.get(chavePedido) || new Set();
    const emProducao = booleanSet.has('EM_PRODUCAO');
    const pedidoPronto = booleanSet.has('PEDIDO_PRONTO');
    const qtdeVolumesConfirmada = booleanSet.has('QTDE_VOLUMES');
    const videoFeito = booleanSet.has('VIDEO_FEITO');
    const querNotaFiscal = booleanSet.has('QUER_NOTA_FISCAL');
    const ligacaoPosVenda = booleanSet.has('LIGACAO_POS_VENDA');
    const etiquetaConcluida = etiquetasSet.has(chavePedido);
    const localEntregaConcluido = localEntregaSet.has(chavePedido) || booleanSet.has('LOCAL_ENTREGA');
    const detalhePagamento = await buscarDetalhePagamentoDoPedido(pedido);
    const pagamentoQuitado = booleanSet.has('PAGAMENTO_QUITADO') || calcularPagamentoQuitado(detalhePagamento);
    const dataExpedicaoConcluida = Boolean(limparTexto(pedido?.dataExpedicao));

    const fasesSemLigacao = [
      emProducao,
      pedidoPronto,
      qtdeVolumesConfirmada,
      etiquetaConcluida,
      videoFeito,
      querNotaFiscal,
      localEntregaConcluido,
      pagamentoQuitado,
      dataExpedicaoConcluida
    ];
    const concluidasSemLigacao = fasesSemLigacao.filter(Boolean).length;
    const semLigacaoConcluido = fasesSemLigacao.every(Boolean);

    return {
      semLigacaoConcluido,
      completo: semLigacaoConcluido && ligacaoPosVenda,
      totalConcluido: concluidasSemLigacao + (ligacaoPosVenda ? 1 : 0)
    };
  });

  const celulasConcluidas = resumosPedidos.reduce((total, item) => total + item.totalConcluido, 0);
  const semicompleta = resumosPedidos.every((item) => item.semLigacaoConcluido);
  const concluida = resumosPedidos.every((item) => item.completo);
  const statusLinha = concluida ? 'completa' : (semicompleta ? 'semicompleta' : 'incompleta');

  return {
    codigoCarrada,
    concluida,
    semicompleta,
    statusLinha,
    percentualConclusao: Number(((celulasConcluidas / totalCelulas) * 100).toFixed(2)),
    totalPedidos,
    totalFases,
    totalCelulas,
    celulasConcluidas
  };
}

async function buscarResumoListaCarradas(codigosParam) {
  return carradasStatusResumoService.listarResumoListaCarradasPersistido(codigosParam);
}

async function salvarMarcacaoSilenciosaEspecial({ codigoCarrada: codigoCarradaParam, numeroPedido: numeroPedidoParam, faseCodigo: faseCodigoParam, valor }) {
  await garantirTabelasModulo();

  const codigoCarrada = parseCodigoCarrada(codigoCarradaParam);
  const numeroPedido = normalizarNumeroPedido(numeroPedidoParam);
  const faseCodigo = limparTexto(faseCodigoParam).toUpperCase();
  const valorBoolean = normalizarBoolean(valor);
  const carrada = await carradasService.buscarResumoCarrada(codigoCarrada);

  if (!carrada) {
    throw criarErro('Carrada não encontrada.', 404);
  }
  const pedido = encontrarPedidoNaCarrada(carrada, numeroPedido);
  const identificadores = obterIdentificadoresPedido(pedido, numeroPedido);

  return sincronizarFaseBooleanaPorPedido({
    codigoCarrada,
    numeroPedido,
    saida: identificadores.saida,
    faseCodigo,
    valorBoolean
  });
}

async function calcularQuantidadeVolumesPedido({ codigoCarrada: codigoCarradaParam, numeroPedido: numeroPedidoParam }) {
  await garantirTabelasModulo();

  const codigoCarrada = parseCodigoCarrada(codigoCarradaParam);
  const numeroPedido = normalizarNumeroPedido(numeroPedidoParam);
  const carrada = await carradasService.buscarResumoCarrada(codigoCarrada);

  if (!carrada) {
    throw criarErro('Carrada não encontrada.', 404);
  }

  const pedido = encontrarPedidoNaCarrada(carrada, numeroPedido);
  const identificadores = obterIdentificadoresPedido(pedido, numeroPedido);

  if (!identificadores.saida) {
    throw criarErro('O pedido não possui identificador para calcular os volumes.', 400);
  }

  const calculo = await pedidosLegadoService.calcularESalvarVolumesPedido(identificadores.saida);
  const marcado = await sincronizarFaseBooleanaPorPedido({
    codigoCarrada,
    numeroPedido,
    saida: identificadores.saida,
    faseCodigo: 'QTDE_VOLUMES',
    valorBoolean: false
  });

  await carradasStatusResumoService.recalcularStatusCarrada(codigoCarrada);

  return {
    numeroPedido,
    quantidade: Number(calculo?.volumes ?? calculo?.totalVolumes ?? 0),
    concluido: false,
    calculadoAutomaticamente: true,
    updatedAt: marcado?.updated_at || null,
    itens: Array.isArray(calculo?.itens) ? calculo.itens : []
  };
}

async function salvarQuantidadeVolumesManual({ codigoCarrada: codigoCarradaParam, numeroPedido: numeroPedidoParam, quantidade: quantidadeParam }) {
  await garantirTabelasModulo();

  const codigoCarrada = parseCodigoCarrada(codigoCarradaParam);
  const numeroPedido = normalizarNumeroPedido(numeroPedidoParam);
  const quantidade = normalizarQuantidadeVolumes(quantidadeParam);
  const carrada = await carradasService.buscarResumoCarrada(codigoCarrada);

  if (!carrada) {
    throw criarErro('Carrada não encontrada.', 404);
  }

  const pedido = encontrarPedidoNaCarrada(carrada, numeroPedido);
  const identificadores = obterIdentificadoresPedido(pedido, numeroPedido);

  if (!identificadores.saida) {
    throw criarErro('O pedido não possui identificador para salvar os volumes.', 400);
  }

  const response = await legadoBridgeService.put(
    `/api/legado/pedidos/${identificadores.saida}/volumes`,
    { volumes: quantidade }
  );
  const salvo = response?.data || {};
  const marcado = await sincronizarFaseBooleanaPorPedido({
    codigoCarrada,
    numeroPedido,
    saida: identificadores.saida,
    faseCodigo: 'QTDE_VOLUMES',
    valorBoolean: true
  });

  await carradasStatusResumoService.recalcularStatusCarrada(codigoCarrada);

  return {
    numeroPedido,
    quantidade: Number(salvo?.volumes ?? quantidade),
    concluido: true,
    calculadoAutomaticamente: false,
    updatedAt: marcado?.updated_at || null
  };
}

async function salvarDataExpedicao({ codigoCarrada: codigoCarradaParam, numeroPedido: numeroPedidoParam, dataExpedicao: dataExpedicaoParam }) {
  const codigoCarrada = parseCodigoCarrada(codigoCarradaParam);
  const numeroPedido = normalizarNumeroPedido(numeroPedidoParam);
  const dataExpedicao = normalizarDataExpedicao(dataExpedicaoParam);
  const carrada = await carradasService.buscarResumoCarrada(codigoCarrada);

  if (!carrada) {
    throw criarErro('Carrada não encontrada.', 404);
  }

  const pedido = encontrarPedidoNaCarrada(carrada, numeroPedido);
  const identificadores = obterIdentificadoresPedido(pedido, numeroPedido);

  if (!identificadores.saida) {
    throw criarErro('O pedido não possui identificador para salvar a data de expedição.', 400);
  }

  const response = await legadoBridgeService.put(
    `/api/carradas/${encodeURIComponent(codigoCarrada)}/pedidos/${encodeURIComponent(numeroPedido)}/data-expedicao`,
    { dataExpedicao: dataExpedicao || null }
  );
  const salvo = response?.dado || response?.data || {};
  const dataSalva = limparTexto(salvo?.dataExpedicao || dataExpedicao);
  let notificacao = null;

  if (dataSalva) {
    const detalhePagamento = await buscarDetalhePagamentoDoPedido(pedido);
    const telefone = normalizarTelefoneLote(pedido, detalhePagamento);
    const mensagem = [
      'MENSAGEM AUTOMÁTICA - ALUMÍNIO JR',
      `📦 Pedido nº ${numeroPedido}`,
      '',
      `Seu pedido foi expedido em ${dataSalva}.`
    ].join('\n');

    try {
      const envio = await whatsappService.enviarMensagem({ telefone, mensagem });
      notificacao = {
        success: true,
        telefone: envio.telefone,
        mensagem,
        response: envio
      };
      await registrarNotificacao({
        faseCodigo: 'DATA_EXPEDICAO',
        codigoCarrada,
        numeroPedido,
        telefone: envio.telefone,
        mensagem,
        statusEnvio: 'sucesso',
        respostaApi: envio.zapi || envio
      });
    } catch (error) {
      notificacao = {
        success: false,
        telefone,
        mensagem,
        error: error.message
      };
      await registrarNotificacao({
        faseCodigo: 'DATA_EXPEDICAO',
        codigoCarrada,
        numeroPedido,
        telefone,
        mensagem,
        statusEnvio: 'erro',
        respostaApi: { error: error.message }
      });
    }
  }

  await carradasStatusResumoService.recalcularStatusCarrada(codigoCarrada);

  return {
    numeroPedido,
    concluido: Boolean(dataSalva),
    dataExpedicao: dataSalva,
    notificacao
  };
}

async function salvarFaseBooleana({ codigoCarrada: codigoCarradaParam, numeroPedido: numeroPedidoParam, faseCodigo: faseCodigoParam, valor, silencioso }) {
  await garantirTabelasModulo();

  const codigoCarrada = parseCodigoCarrada(codigoCarradaParam);
  const numeroPedido = normalizarNumeroPedido(numeroPedidoParam);
  const faseCodigo = limparTexto(faseCodigoParam).toUpperCase();
  const valorBoolean = normalizarBoolean(valor);

  if (faseCodigo === 'ETIQUETA_VOLUMES' && silencioso) {
    return confirmarEtiquetaVolumes({
      codigoCarrada,
      numeroPedido,
      confirmado: valorBoolean
    });
  }

  if (faseCodigo === 'LOCAL_ENTREGA' && silencioso) {
    const marcado = await salvarMarcacaoSilenciosaEspecial({
      codigoCarrada,
      numeroPedido,
      faseCodigo,
      valor: valorBoolean
    });

    await carradasStatusResumoService.recalcularStatusCarrada(codigoCarrada);

    return {
      numeroPedido,
      concluido: Boolean(marcado?.valor_boolean),
      transportadoraId: null,
      transportadoraNome: '',
      agenciaRecebimentoCodigo: null,
      agenciaRecebimentoNome: '',
      agenciaCidade: '',
      updatedAt: marcado?.updated_at || null
    };
  }

  if (!FASES_BOOLEANAS[faseCodigo]) {
    throw criarErro('Fase booleana inválida.', 400);
  }

  const carrada = await carradasService.buscarResumoCarrada(codigoCarrada);

  if (!carrada) {
    throw criarErro('Carrada não encontrada.', 404);
  }
  const pedido = encontrarPedidoNaCarrada(carrada, numeroPedido);
  const identificadores = obterIdentificadoresPedido(pedido, numeroPedido);
  const anterior = await buscarUltimaFaseBooleanaPorPedido({
    saida: identificadores.saida,
    numeroPedido,
    faseCodigo
  });
  const valorAnterior = anterior ? Boolean(anterior.valor_boolean) : false;

  const marcado = await sincronizarFaseBooleanaPorPedido({
    codigoCarrada,
    numeroPedido,
    saida: identificadores.saida,
    faseCodigo,
    valorBoolean
  });

  const detalhePagamento = await buscarDetalhePagamentoDoPedido(pedido);
  const resumoPedido = montarResumoPedido(pedido, detalhePagamento);

  let notificacao = null;

  if (valorBoolean && !valorAnterior && FASES_BOOLEANAS[faseCodigo].enviaWhatsapp && !silencioso) {
    const telefone = normalizarTelefonePedido(detalhePagamento);
    const mensagem = FASES_BOOLEANAS[faseCodigo].construirMensagem({
      numeroPedido,
      nomeCliente: resumoPedido?.cliente?.nome || 'Cliente',
      valorPedido: resumoPedido?.valorPedido || pedido?.total || 0,
      data: formatarDataBR(new Date())
    });

    try {
      const envio = await whatsappService.enviarMensagem({ telefone, mensagem });
      notificacao = {
        success: true,
        telefone: envio.telefone,
        mensagem,
        response: envio
      };
      await registrarNotificacao({
        faseCodigo,
        codigoCarrada,
        numeroPedido,
        telefone: envio.telefone,
        mensagem,
        statusEnvio: 'sucesso',
        respostaApi: envio.zapi || envio
      });
    } catch (error) {
      notificacao = {
        success: false,
        telefone,
        mensagem,
        error: error.message
      };
      await registrarNotificacao({
        faseCodigo,
        codigoCarrada,
        numeroPedido,
        telefone,
        mensagem,
        statusEnvio: 'erro',
        respostaApi: { error: error.message }
      });
    }
  }

  await carradasStatusResumoService.recalcularStatusCarrada(codigoCarrada);

  return {
    fase: {
      codigo: faseCodigo,
      nome: FASES_BOOLEANAS[faseCodigo].nome,
      concluido: Boolean(marcado?.valor_boolean),
      updatedAt: marcado?.updated_at || null
    },
    resumoPedido,
    notificacao
  };
}

async function listarEtiquetasDoCliente(favorecido) {
  const result = await pool.query(
    `
      SELECT id, favorecido, apelido, texto_etiqueta, ativo, created_at, updated_at
      FROM clientes_etiquetas_volumes
      WHERE favorecido = $1
      ORDER BY ativo DESC, LOWER(apelido), id DESC
    `,
    [favorecido]
  );

  return result.rows.map((row) => ({
    id: row.id,
    favorecido: row.favorecido,
    apelido: row.apelido || '',
    textoEtiqueta: row.texto_etiqueta || '',
    ativo: Boolean(row.ativo),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null
  }));
}

async function buscarDadosEtiquetaPedido({ codigoCarrada: codigoCarradaParam, numeroPedido: numeroPedidoParam }) {
  await garantirTabelasModulo();

  const codigoCarrada = parseCodigoCarrada(codigoCarradaParam);
  const numeroPedido = normalizarNumeroPedido(numeroPedidoParam);
  const carrada = await carradasService.buscarResumoCarrada(codigoCarrada);

  if (!carrada) {
    throw criarErro('Carrada não encontrada.', 404);
  }
  const pedido = encontrarPedidoNaCarrada(carrada, numeroPedido);
  const identificadores = obterIdentificadoresPedido(pedido, numeroPedido);
  const etiquetasCliente = await listarEtiquetasDoCliente(pedido?.cliente?.favorecido ?? null);

  const atualResult = await pool.query(
    `
      SELECT
        p.codigo_carrada,
        p.numero_pedido,
        p.saida,
        p.etiqueta_cliente_id,
        p.texto_snapshot,
        p.confirmado_boolean,
        p.enviado_em,
        p.confirmado_em,
        p.created_at,
        p.updated_at,
        c.apelido,
        c.texto_etiqueta
      FROM carradas_pedidos_etiquetas_volumes p
      LEFT JOIN clientes_etiquetas_volumes c ON c.id = p.etiqueta_cliente_id
      WHERE ${montarCondicaoPedidoPorSaidaOuNumero('p')}
      ORDER BY COALESCE(p.updated_at, p.created_at) DESC, p.codigo_carrada DESC
      LIMIT 1
    `,
    [identificadores.saida, numeroPedido]
  );

  const atual = atualResult.rows[0]
    ? {
        etiquetaClienteId: atualResult.rows[0].etiqueta_cliente_id,
        apelido: atualResult.rows[0].apelido || '',
        textoSnapshot: atualResult.rows[0].texto_snapshot || '',
        textoEtiqueta: atualResult.rows[0].texto_etiqueta || '',
        confirmadoBoolean: Boolean(atualResult.rows[0].confirmado_boolean),
        enviadoEm: atualResult.rows[0].enviado_em || null,
        confirmadoEm: atualResult.rows[0].confirmado_em || null,
        createdAt: atualResult.rows[0].created_at || null,
        updatedAt: atualResult.rows[0].updated_at || null
      }
    : null;

  return {
    pedido: {
      numero: pedido.numero,
      cliente: pedido.cliente || {},
      data: pedido.data || null,
      total: Number(pedido.total ?? 0)
    },
    etiquetas: etiquetasCliente,
    atual
  };
}

async function resolverEtiquetaCliente({ favorecido, etiquetaClienteId, apelido, textoEtiqueta }) {
  if (etiquetaClienteId) {
    const result = await pool.query(
      `
        SELECT id, favorecido, apelido, texto_etiqueta, ativo
        FROM clientes_etiquetas_volumes
        WHERE id = $1
      `,
      [Number(etiquetaClienteId)]
    );

    const etiqueta = result.rows[0];

    if (!etiqueta) {
      throw criarErro('Etiqueta de volumes não encontrada.', 404);
    }

    if (Number(etiqueta.favorecido) !== Number(favorecido)) {
      throw criarErro('A etiqueta selecionada não pertence ao cliente deste pedido.', 400);
    }

    return {
      id: etiqueta.id,
      favorecido: etiqueta.favorecido,
      apelido: etiqueta.apelido || '',
      textoEtiqueta: etiqueta.texto_etiqueta || ''
    };
  }

  const apelidoNormalizado = limparTexto(apelido);
  const textoNormalizado = limparTexto(textoEtiqueta);

  if (!apelidoNormalizado) {
    throw criarErro('Informe o apelido do texto da etiqueta.', 400);
  }

  if (!textoNormalizado) {
    throw criarErro('Informe o texto da etiqueta.', 400);
  }

  const result = await pool.query(
    `
      INSERT INTO clientes_etiquetas_volumes (
        favorecido,
        apelido,
        texto_etiqueta,
        ativo
      ) VALUES ($1, $2, $3, TRUE)
      RETURNING id, favorecido, apelido, texto_etiqueta, ativo
    `,
    [favorecido, apelidoNormalizado, textoNormalizado]
  );

  return {
    id: result.rows[0].id,
    favorecido: result.rows[0].favorecido,
    apelido: result.rows[0].apelido || '',
    textoEtiqueta: result.rows[0].texto_etiqueta || ''
  };
}

async function enviarEtiquetaVolumes({ codigoCarrada: codigoCarradaParam, numeroPedido: numeroPedidoParam, etiquetaClienteId, apelido, textoEtiqueta }) {
  await garantirTabelasModulo();

  const codigoCarrada = parseCodigoCarrada(codigoCarradaParam);
  const numeroPedido = normalizarNumeroPedido(numeroPedidoParam);
  const carrada = await carradasService.buscarResumoCarrada(codigoCarrada);

  if (!carrada) {
    throw criarErro('Carrada não encontrada.', 404);
  }
  const pedido = encontrarPedidoNaCarrada(carrada, numeroPedido);
  const identificadores = obterIdentificadoresPedido(pedido, numeroPedido);
  const favorecido = pedido?.cliente?.favorecido;

  if (!favorecido) {
    throw criarErro('Cliente do pedido não encontrado para etiqueta de volumes.', 400);
  }

  const etiqueta = await resolverEtiquetaCliente({
    favorecido,
    etiquetaClienteId,
    apelido,
    textoEtiqueta
  });

  const textoSnapshot = etiqueta.textoEtiqueta;

  await pool.query(
    `
      INSERT INTO carradas_pedidos_etiquetas_volumes (
        codigo_carrada,
        numero_pedido,
        saida,
        etiqueta_cliente_id,
        texto_snapshot,
        confirmado_boolean,
        enviado_em,
        confirmado_em
      ) VALUES ($1, $2, $3, $4, $5, FALSE, NOW(), NULL)
      ON CONFLICT (codigo_carrada, numero_pedido)
      DO UPDATE SET
        saida = EXCLUDED.saida,
        etiqueta_cliente_id = EXCLUDED.etiqueta_cliente_id,
        texto_snapshot = EXCLUDED.texto_snapshot,
        confirmado_boolean = FALSE,
        enviado_em = NOW(),
        confirmado_em = NULL,
        updated_at = NOW()
      RETURNING codigo_carrada, numero_pedido, etiqueta_cliente_id, texto_snapshot, confirmado_boolean, enviado_em, confirmado_em, updated_at
    `,
    [codigoCarrada, numeroPedido, identificadores.saida, etiqueta.id, textoSnapshot]
  );

  await excluirFaseBooleanaPorPedido({
    saida: identificadores.saida,
    numeroPedido,
    faseCodigo: 'ETIQUETA_VOLUMES'
  });

  const detalhePagamento = await buscarDetalhePagamentoDoPedido(pedido);
  const telefone = normalizarTelefonePedido(detalhePagamento);
  const mensagem = [
    `📦 Pedido nº ${numeroPedido}`,
    '',
    `Cliente: ${pedido?.cliente?.nome || 'Cliente'}`,
    '',
    'Confirma os dizeres abaixo para a etiqueta de volumes deste pedido?',
    '',
    textoSnapshot
  ].join('\n');

  let notificacao = null;

  try {
    const envio = await whatsappService.enviarMensagem({ telefone, mensagem });
    notificacao = {
      success: true,
      telefone: envio.telefone,
      mensagem,
      response: envio
    };
    await registrarNotificacao({
      faseCodigo: 'ETIQUETA_VOLUMES',
      codigoCarrada,
      numeroPedido,
      telefone: envio.telefone,
      mensagem,
      statusEnvio: 'sucesso',
      respostaApi: envio.zapi || envio
    });
  } catch (error) {
    notificacao = {
      success: false,
      telefone,
      mensagem,
      error: error.message
    };
    await registrarNotificacao({
      faseCodigo: 'ETIQUETA_VOLUMES',
      codigoCarrada,
      numeroPedido,
      telefone,
      mensagem,
      statusEnvio: 'erro',
      respostaApi: { error: error.message }
    });
  }

  await carradasStatusResumoService.recalcularStatusCarrada(codigoCarrada);

  return {
    pedido: {
      numero: pedido.numero,
      cliente: pedido.cliente || {},
      data: pedido.data || null,
      total: Number(pedido.total ?? 0)
    },
    etiqueta: {
      etiquetaClienteId: etiqueta.id,
      apelido: etiqueta.apelido,
      textoSnapshot,
      confirmadoBoolean: false,
      enviadoEm: new Date().toISOString(),
      confirmadoEm: null
    },
    notificacao
  };
}

async function confirmarEtiquetaVolumes({ codigoCarrada: codigoCarradaParam, numeroPedido: numeroPedidoParam, confirmado }) {
  await garantirTabelasModulo();

  const codigoCarrada = parseCodigoCarrada(codigoCarradaParam);
  const numeroPedido = normalizarNumeroPedido(numeroPedidoParam);
  const confirmadoBoolean = normalizarBoolean(confirmado);
  const carrada = await carradasService.buscarResumoCarrada(codigoCarrada);

  if (!carrada) {
    throw criarErro('Carrada não encontrada.', 404);
  }

  const pedido = encontrarPedidoNaCarrada(carrada, numeroPedido);
  const identificadores = obterIdentificadoresPedido(pedido, numeroPedido);

  const result = await pool.query(
    `
      UPDATE carradas_pedidos_etiquetas_volumes
      SET confirmado_boolean = $3,
          confirmado_em = CASE WHEN $3 THEN NOW() ELSE NULL END,
          updated_at = NOW()
      WHERE ${montarCondicaoPedidoPorSaidaOuNumero()}
      RETURNING codigo_carrada, numero_pedido, etiqueta_cliente_id, texto_snapshot, confirmado_boolean, enviado_em, confirmado_em, updated_at
    `,
    [identificadores.saida, numeroPedido, confirmadoBoolean]
  );

  if (!result.rows.length) {
    const fallback = await salvarMarcacaoSilenciosaEspecial({
      codigoCarrada,
      numeroPedido,
      faseCodigo: 'ETIQUETA_VOLUMES',
      valor: confirmadoBoolean
    });

    await carradasStatusResumoService.recalcularStatusCarrada(codigoCarrada);

    return {
      numeroPedido,
      confirmadoBoolean: Boolean(fallback?.valor_boolean),
      enviadoEm: null,
      confirmadoEm: confirmadoBoolean ? fallback?.updated_at || null : null,
      updatedAt: fallback?.updated_at || null
    };
  }

  await excluirFaseBooleanaPorPedido({
    saida: identificadores.saida,
    numeroPedido,
    faseCodigo: 'ETIQUETA_VOLUMES'
  });

  await carradasStatusResumoService.recalcularStatusCarrada(codigoCarrada);

  const atualizada = result.rows
    .slice()
    .sort((a, b) => new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime())[0];

  return {
    numeroPedido,
    confirmadoBoolean: Boolean(atualizada.confirmado_boolean),
    enviadoEm: atualizada.enviado_em || null,
    confirmadoEm: atualizada.confirmado_em || null,
    updatedAt: atualizada.updated_at || null
  };
}

async function buscarPedidoAnteriorComLocalEntregaValido(pedidoAtual) {
  const favorecido = Number.parseInt(pedidoAtual?.cliente?.favorecido, 10);

  if (!Number.isInteger(favorecido) || favorecido <= 0) {
    throw criarErro('Não foi possível identificar o cliente deste pedido.', 400);
  }

  const response = await legadoBridgeService.get(`/api/pedidos-cliente/${favorecido}`);
  const pedidos = Array.isArray(response?.dados) ? response.dados : [];
  const saidaAtual = normalizarSaida(pedidoAtual?.saida);
  const numeroAtual = limparTexto(pedidoAtual?.numero);

  const indiceAtual = pedidos.findIndex((item) => {
    const saida = normalizarSaida(item?.saida);
    if (saidaAtual !== null && saida !== null) {
      return saida === saidaAtual;
    }
    return limparTexto(item?.numero) === numeroAtual;
  });

  if (indiceAtual < 0) {
    throw criarErro('O pedido atual não foi localizado no histórico do cliente.', 404);
  }

  const pedidosAnteriores = pedidos.slice(indiceAtual + 1);

  if (!pedidosAnteriores.length) {
    throw criarErro('Este cliente não possui pedido anterior ao pedido atual.', 404);
  }

  // Carrega os locais de entrega de todos os pedidos anteriores de uma só vez e
  // percorre o histórico do mais recente para o mais antigo. Assim, pedidos sem
  // LOCAL DE ENTREGA não bloqueiam a busca pelo último registro aproveitável.
  const locaisEntrega = await buscarLocalEntregaRowsDosPedidos(pedidosAnteriores);

  for (const pedidoAnterior of pedidosAnteriores) {
    const chave = criarChavePedido({
      saida: pedidoAnterior?.saida,
      numero: pedidoAnterior?.numero
    });
    const localEntrega = chave ? locaisEntrega.get(chave) || null : null;

    if (localEntrega?.transportadoraId) {
      return { pedidoAnterior, localEntrega };
    }
  }

  throw criarErro('Nenhum pedido anterior deste cliente possui local de entrega registrado.', 404);
}

async function perguntarRepeticaoLocalEntrega({ codigoCarrada: codigoCarradaParam, numeroPedido: numeroPedidoParam }) {
  await garantirTabelasModulo();

  const codigoCarrada = parseCodigoCarrada(codigoCarradaParam);
  const numeroPedido = normalizarNumeroPedido(numeroPedidoParam);
  const carrada = await carradasService.buscarResumoCarrada(codigoCarrada);

  if (!carrada) {
    throw criarErro('Carrada não encontrada.', 404);
  }

  const pedidoAtual = encontrarPedidoNaCarrada(carrada, numeroPedido);
  const { pedidoAnterior, localEntrega: localEntregaAnterior } = await buscarPedidoAnteriorComLocalEntregaValido(pedidoAtual);

  const detalhePagamento = await buscarDetalhePagamentoDoPedido(pedidoAtual);
  const telefone = normalizarTelefoneLote(pedidoAtual, detalhePagamento);

  if (!telefone) {
    throw criarErro('O cliente não possui telefone de WhatsApp cadastrado.', 400);
  }

  const numeroPedidoAnterior = limparTexto(pedidoAnterior?.numero) || '-';
  const transportadoraNome = limparTexto(localEntregaAnterior?.transportadoraNome) || '-';
  const redespachoTransportadoraNome = limparTexto(localEntregaAnterior?.redespachoTransportadoraNome);
  const agenciaRecebimentoNome = limparTexto(localEntregaAnterior?.agenciaRecebimentoNome || localEntregaAnterior?.agenciaCidade);
  const agenciaRecebimentoCidadeNome = limparTexto(localEntregaAnterior?.agenciaRecebimentoCidadeNome);
  const agenciaRecebimentoCidadeUf = limparTexto(localEntregaAnterior?.agenciaRecebimentoCidadeUf).toUpperCase();
  const agenciaLocalizacao = agenciaRecebimentoCidadeNome
    ? `${agenciaRecebimentoCidadeNome}${agenciaRecebimentoCidadeUf ? ` / ${agenciaRecebimentoCidadeUf}` : ''}`
    : '';
  const agenciaDescricao = [agenciaRecebimentoNome, agenciaLocalizacao].filter(Boolean).join(' - ');
  const mensagem = [
    'MENSAGEM AUTOMÁTICA - ALUMÍNIO JR',
    `📦 Pedido nº ${numeroPedido}`,
    '',
    `No seu pedido anterior nº ${numeroPedidoAnterior}, o local de entrega foi:`,
    `Transportadora / excursão: ${transportadoraNome}`,
    `Redespacho: ${redespachoTransportadoraNome || 'não informado'}`,
    `Agência de recebimento: ${agenciaDescricao || 'não informada'}`,
    '',
    'Podemos repetir estes mesmos dados de entrega neste pedido?'
  ].join('\n');

  let notificacao;

  try {
    const envio = await whatsappService.enviarMensagem({ telefone, mensagem });
    notificacao = {
      success: true,
      telefone: envio.telefone,
      mensagem,
      response: envio
    };

    await registrarNotificacao({
      faseCodigo: 'LOCAL_ENTREGA',
      codigoCarrada,
      numeroPedido,
      telefone: envio.telefone,
      mensagem,
      statusEnvio: 'sucesso',
      respostaApi: envio.zapi || envio
    });
  } catch (error) {
    notificacao = {
      success: false,
      telefone,
      mensagem,
      error: error.message
    };

    await registrarNotificacao({
      faseCodigo: 'LOCAL_ENTREGA',
      codigoCarrada,
      numeroPedido,
      telefone,
      mensagem,
      statusEnvio: 'erro',
      respostaApi: { error: error.message }
    });
  }

  return {
    numeroPedido,
    pedidoAnterior: {
      numero: numeroPedidoAnterior,
      saida: normalizarSaida(pedidoAnterior?.saida),
      data: pedidoAnterior?.data || null
    },
    localEntregaAnterior: {
      transportadoraId: localEntregaAnterior.transportadoraId,
      transportadoraNome,
      redespachoTransportadoraId: localEntregaAnterior.redespachoTransportadoraId || null,
      redespachoTransportadoraNome,
      agenciaRecebimentoCodigo: localEntregaAnterior.agenciaRecebimentoCodigo || null,
      agenciaRecebimentoNome,
      agenciaRecebimentoCidadeNome,
      agenciaRecebimentoCidadeUf,
      agenciaCidade: localEntregaAnterior.agenciaCidade || agenciaRecebimentoNome
    },
    notificacao
  };
}

async function enviarNotificacaoLocalEntrega({ codigoCarrada, numeroPedido, telefone, mensagem, telefoneObrigatorioMensagem }) {
  const telefoneNormalizado = limparTexto(telefone);

  if (!telefoneNormalizado) {
    const error = telefoneObrigatorioMensagem || 'Telefone não cadastrado.';
    await registrarNotificacao({
      faseCodigo: 'LOCAL_ENTREGA',
      codigoCarrada,
      numeroPedido,
      telefone: '',
      mensagem,
      statusEnvio: 'erro',
      respostaApi: { error }
    });

    return {
      success: false,
      telefone: '',
      mensagem,
      error,
      telefonePendente: true
    };
  }

  try {
    const envio = await whatsappService.enviarMensagem({ telefone: telefoneNormalizado, mensagem });
    await registrarNotificacao({
      faseCodigo: 'LOCAL_ENTREGA',
      codigoCarrada,
      numeroPedido,
      telefone: envio.telefone,
      mensagem,
      statusEnvio: 'sucesso',
      respostaApi: envio.zapi || envio
    });

    return {
      success: true,
      telefone: envio.telefone,
      mensagem,
      response: envio
    };
  } catch (error) {
    await registrarNotificacao({
      faseCodigo: 'LOCAL_ENTREGA',
      codigoCarrada,
      numeroPedido,
      telefone: telefoneNormalizado,
      mensagem,
      statusEnvio: 'erro',
      respostaApi: { error: error.message }
    });

    return {
      success: false,
      telefone: telefoneNormalizado,
      mensagem,
      error: error.message
    };
  }
}

function montarMensagemDestinoLocalEntrega({ pedido, numeroPedido, carrada }) {
  const nomeCliente = limparTexto(pedido?.cliente?.nome) || '-';
  const quantidadeVolumesBruta = Number(pedido?.qtdeVolume ?? pedido?.volumes ?? 0);
  const quantidadeVolumes = Number.isFinite(quantidadeVolumesBruta) && quantidadeVolumesBruta >= 0
    ? Math.trunc(quantidadeVolumesBruta)
    : 0;
  const dataCarrada = formatarDataBR(carrada?.data) || '-';
  const descricaoCarrada = limparTexto(carrada?.descricao) || '-';

  return [
    'MENSAGEM AUTOMÁTICA - ALUMÍNIO JR',
    `${dataCarrada} - ${descricaoCarrada}`,
    `Nome cliente: ${nomeCliente}`,
    `Número pedido: ${numeroPedido}`,
    '',
    `Previsão qtde volume: ${quantidadeVolumes}`
  ].join('\n');
}

async function salvarLocalEntrega({
  codigoCarrada: codigoCarradaParam,
  numeroPedido: numeroPedidoParam,
  transportadoraId,
  redespachoTransportadoraId,
  agenciaRecebimentoCodigo
}) {
  await garantirTabelasModulo();

  const codigoCarrada = parseCodigoCarrada(codigoCarradaParam);
  const numeroPedido = normalizarNumeroPedido(numeroPedidoParam);
  const carrada = await carradasService.buscarResumoCarrada(codigoCarrada);

  if (!carrada) {
    throw criarErro('Carrada não encontrada.', 404);
  }

  const pedido = encontrarPedidoNaCarrada(carrada, numeroPedido);
  const identificadores = obterIdentificadoresPedido(pedido, numeroPedido);

  if (transportadoraId === null || transportadoraId === undefined || transportadoraId === '') {
    await pool.query(
      `DELETE FROM carradas_pedidos_local_entrega WHERE ${montarCondicaoPedidoPorSaidaOuNumero()}`,
      [identificadores.saida, numeroPedido]
    );

    await excluirFaseBooleanaPorPedido({
      saida: identificadores.saida,
      numeroPedido,
      faseCodigo: 'LOCAL_ENTREGA'
    });

    await carradasStatusResumoService.recalcularStatusCarrada(codigoCarrada);

    return {
      numeroPedido,
      concluido: false,
      transportadoraId: null,
      transportadoraNome: '',
      redespachoTransportadoraId: null,
      redespachoTransportadoraNome: '',
      agenciaRecebimentoCodigo: null,
      agenciaRecebimentoNome: '',
      agenciaRecebimentoCidadeNome: '',
      agenciaRecebimentoCidadeUf: '',
      agenciaCidade: ''
    };
  }

  const transportadoraIdInt = Number.parseInt(transportadoraId, 10);

  if (!Number.isInteger(transportadoraIdInt) || transportadoraIdInt <= 0) {
    throw criarErro('Transportadora inválida.', 400);
  }

  let redespachoTransportadoraIdInt = null;
  if (redespachoTransportadoraId !== null && redespachoTransportadoraId !== undefined && redespachoTransportadoraId !== '') {
    redespachoTransportadoraIdInt = Number.parseInt(redespachoTransportadoraId, 10);
    if (!Number.isInteger(redespachoTransportadoraIdInt) || redespachoTransportadoraIdInt <= 0) {
      throw criarErro('Transportadora de redespacho inválida.', 400);
    }
  }

  const idsTransportadoras = [transportadoraIdInt, redespachoTransportadoraIdInt].filter(Boolean);
  const transportadorasResult = await pool.query(
    `SELECT id, nome, telefone_principal FROM transportadoras WHERE id = ANY($1::bigint[])`,
    [idsTransportadoras]
  );
  const transportadorasPorId = new Map(transportadorasResult.rows.map((item) => [Number(item.id), item]));
  const transportadora = transportadorasPorId.get(transportadoraIdInt);
  const redespachoTransportadora = redespachoTransportadoraIdInt
    ? transportadorasPorId.get(redespachoTransportadoraIdInt)
    : null;

  if (!transportadora) {
    throw criarErro('Transportadora não encontrada.', 404);
  }
  if (redespachoTransportadoraIdInt && !redespachoTransportadora) {
    throw criarErro('Transportadora de redespacho não encontrada.', 404);
  }

  let agenciaRecebimentoCodigoInt = null;
  let agenciaRecebimento = null;
  if (agenciaRecebimentoCodigo !== null && agenciaRecebimentoCodigo !== undefined && agenciaRecebimentoCodigo !== '') {
    agenciaRecebimentoCodigoInt = Number.parseInt(agenciaRecebimentoCodigo, 10);
    if (!Number.isInteger(agenciaRecebimentoCodigoInt) || agenciaRecebimentoCodigoInt <= 0) {
      throw criarErro('Agência de Recebimento inválida.', 400);
    }

    const agenciaResult = await pool.query(
      `
        SELECT
          a.codigo,
          a.nome,
          a.telefone,
          a.cidade_id,
          c.nome AS cidade_nome,
          c.estado AS cidade_estado
        FROM agencias_recebimento a
        LEFT JOIN cidades c ON c.id = a.cidade_id
        WHERE a.codigo = $1
        LIMIT 1
      `,
      [agenciaRecebimentoCodigoInt]
    );
    agenciaRecebimento = agenciaResult.rows[0] || null;

    if (!agenciaRecebimento) {
      throw criarErro('Agência de Recebimento não encontrada.', 404);
    }
  }

  // Antes de concluir o local de entrega, garante que o pedido tenha a quantidade
  // de volumes calculada. Reaproveita exatamente a mesma rotina acionada pelo link
  // "CALCULAR AUTOMÁTICO" da coluna Qtde Vols.
  const quantidadeVolumesAtualBruta = Number(pedido?.qtdeVolume ?? pedido?.volumes ?? 0);
  const quantidadeVolumesAtual = Number.isFinite(quantidadeVolumesAtualBruta) && quantidadeVolumesAtualBruta > 0
    ? Math.trunc(quantidadeVolumesAtualBruta)
    : 0;

  let quantidadeVolumes = quantidadeVolumesAtual;
  let volumesCalculadosAutomaticamente = false;

  if (quantidadeVolumes <= 0) {
    const calculoVolumes = await calcularQuantidadeVolumesPedido({
      codigoCarrada,
      numeroPedido
    });

    const quantidadeCalculadaBruta = Number(calculoVolumes?.quantidade ?? 0);
    quantidadeVolumes = Number.isFinite(quantidadeCalculadaBruta) && quantidadeCalculadaBruta > 0
      ? Math.trunc(quantidadeCalculadaBruta)
      : 0;

    if (quantidadeVolumes <= 0) {
      throw criarErro(
        'O cálculo automático não encontrou uma quantidade válida de volumes. O local de entrega não foi salvo.',
        400
      );
    }

    volumesCalculadosAutomaticamente = true;
  }

  // Usa a quantidade confirmada/calculada também nas mensagens enviadas nesta
  // mesma requisição, evitando que o objeto carregado antes do cálculo mantenha 0.
  const pedidoComVolumes = {
    ...pedido,
    qtdeVolume: quantidadeVolumes,
    volumes: quantidadeVolumes
  };

  // Mantém o texto legado preenchido com o nome da agência para compatibilidade
  // com rotinas antigas. A associação nova é feita pelo código da entidade.
  const agenciaCidadeNormalizada = agenciaRecebimento?.nome || null;
  const localAnteriorResult = await pool.query(
    `
      SELECT transportadora_id, redespacho_transportadora_id, agencia_recebimento_codigo
      FROM carradas_pedidos_local_entrega
      WHERE codigo_carrada = $1 AND numero_pedido = $2
      LIMIT 1
    `,
    [codigoCarrada, numeroPedido]
  );
  const localAnterior = localAnteriorResult.rows[0] || null;
  const transportadoraFoiDefinidaAgora = Number(localAnterior?.transportadora_id || 0) !== transportadoraIdInt;
  const redespachoFoiDefinidoAgora = Number(localAnterior?.redespacho_transportadora_id || 0) !== Number(redespachoTransportadoraIdInt || 0);
  const agenciaFoiDefinidaAgora = Number(localAnterior?.agencia_recebimento_codigo || 0) !== Number(agenciaRecebimentoCodigoInt || 0);

  const result = await pool.query(
    `
      INSERT INTO carradas_pedidos_local_entrega (
        codigo_carrada,
        numero_pedido,
        saida,
        transportadora_id,
        redespacho_transportadora_id,
        agencia_recebimento_codigo,
        agencia_cidade
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (codigo_carrada, numero_pedido)
      DO UPDATE SET
        saida = EXCLUDED.saida,
        transportadora_id = EXCLUDED.transportadora_id,
        redespacho_transportadora_id = EXCLUDED.redespacho_transportadora_id,
        agencia_recebimento_codigo = EXCLUDED.agencia_recebimento_codigo,
        agencia_cidade = EXCLUDED.agencia_cidade,
        updated_at = NOW()
      RETURNING codigo_carrada, numero_pedido, saida, transportadora_id, redespacho_transportadora_id, agencia_recebimento_codigo, agencia_cidade, updated_at
    `,
    [
      codigoCarrada,
      numeroPedido,
      identificadores.saida,
      transportadoraIdInt,
      redespachoTransportadoraIdInt,
      agenciaRecebimentoCodigoInt,
      agenciaCidadeNormalizada
    ]
  );

  await excluirFaseBooleanaPorPedido({
    saida: identificadores.saida,
    numeroPedido,
    faseCodigo: 'LOCAL_ENTREGA'
  });

  // O cliente continua usando exatamente o mesmo telefone já utilizado pelo módulo.
  // telefone_principal abaixo é exclusivo da entidade TRANSPORTADORA.
  const detalhePagamento = await buscarDetalhePagamentoDoPedido(pedido);
  const telefoneCliente = normalizarTelefoneLote(pedido, detalhePagamento);
  const clienteDetalhePagamento = detalhePagamento?.pedido?.cliente || {};
  const pedidoComVolumesEDadosCliente = {
    ...pedidoComVolumes,
    cliente: {
      ...(pedidoComVolumes?.cliente || {}),
      nome: clienteDetalhePagamento.nome || pedidoComVolumes?.cliente?.nome || '',
      cidade: clienteDetalhePagamento.cidade || pedidoComVolumes?.cliente?.cidade || ''
    }
  };

  const dataCarrada = formatarDataBR(carrada?.data) || '-';
  const descricaoCarrada = limparTexto(carrada?.descricao) || '-';
  const linhasMensagemCliente = [
    'MENSAGEM AUTOMÁTICA - ALUMÍNIO JR',
    `Número pedido: ${numeroPedido}`,
    `${dataCarrada} - ${descricaoCarrada}`,
    `Transportadora / Excursão: ${transportadora.nome || '-'}`
  ];

  if (redespachoTransportadora) {
    linhasMensagemCliente.push(`Redespacho: ${redespachoTransportadora.nome || '-'}`);
  }

  if (agenciaRecebimento) {
    linhasMensagemCliente.push(`Agência de recebimento: ${agenciaRecebimento.nome || '-'}`);
  }

  linhasMensagemCliente.push('', `Previsão de volumes: ${quantidadeVolumes}`);

  const mensagemCliente = linhasMensagemCliente.join('\n');

  const notificacaoCliente = await enviarNotificacaoLocalEntrega({
    codigoCarrada,
    numeroPedido,
    telefone: telefoneCliente,
    mensagem: mensagemCliente,
    telefoneObrigatorioMensagem: 'O cliente não possui telefone de WhatsApp cadastrado.'
  });

  let notificacaoTransportadora = null;
  if (transportadoraFoiDefinidaAgora) {
    const mensagemTransportadora = montarMensagemDestinoLocalEntrega({
      pedido: pedidoComVolumesEDadosCliente,
      numeroPedido,
      carrada
    });
    notificacaoTransportadora = await enviarNotificacaoLocalEntrega({
      codigoCarrada,
      numeroPedido,
      telefone: transportadora.telefone_principal,
      mensagem: mensagemTransportadora,
      telefoneObrigatorioMensagem: 'A transportadora não possui Telefone Principal cadastrado.'
    });
  }

  let notificacaoRedespacho = null;
  if (redespachoTransportadora && redespachoFoiDefinidoAgora) {
    const mensagemRedespacho = montarMensagemDestinoLocalEntrega({
      pedido: pedidoComVolumesEDadosCliente,
      numeroPedido,
      carrada
    });
    notificacaoRedespacho = await enviarNotificacaoLocalEntrega({
      codigoCarrada,
      numeroPedido,
      telefone: redespachoTransportadora.telefone_principal,
      mensagem: mensagemRedespacho,
      telefoneObrigatorioMensagem: 'A transportadora de redespacho não possui Telefone Principal cadastrado.'
    });
  }

  let notificacaoAgencia = null;
  if (agenciaRecebimento && agenciaFoiDefinidaAgora) {
    const mensagemAgencia = montarMensagemDestinoLocalEntrega({
      pedido: pedidoComVolumesEDadosCliente,
      numeroPedido,
      carrada
    });
    notificacaoAgencia = await enviarNotificacaoLocalEntrega({
      codigoCarrada,
      numeroPedido,
      telefone: agenciaRecebimento.telefone,
      mensagem: mensagemAgencia,
      telefoneObrigatorioMensagem: 'A Agência de Recebimento não possui telefone cadastrado.'
    });
  }

  await carradasStatusResumoService.recalcularStatusCarrada(codigoCarrada);

  return {
    numeroPedido,
    concluido: true,
    transportadoraId: result.rows[0].transportadora_id,
    transportadoraNome: transportadora.nome || '',
    transportadoraTelefonePrincipal: transportadora.telefone_principal || '',
    redespachoTransportadoraId: result.rows[0].redespacho_transportadora_id || null,
    redespachoTransportadoraNome: redespachoTransportadora?.nome || '',
    redespachoTransportadoraTelefonePrincipal: redespachoTransportadora?.telefone_principal || '',
    agenciaRecebimentoCodigo: result.rows[0].agencia_recebimento_codigo || null,
    agenciaRecebimentoNome: agenciaRecebimento?.nome || result.rows[0].agencia_cidade || '',
    agenciaRecebimentoTelefone: agenciaRecebimento?.telefone || '',
    agenciaRecebimentoCidadeId: agenciaRecebimento?.cidade_id || null,
    agenciaRecebimentoCidadeNome: agenciaRecebimento?.cidade_nome || '',
    agenciaRecebimentoCidadeUf: agenciaRecebimento?.cidade_estado || '',
    agenciaCidade: result.rows[0].agencia_cidade || agenciaRecebimento?.nome || '',
    updatedAt: result.rows[0].updated_at || null,
    quantidadeVolumes,
    volumesCalculadosAutomaticamente,
    notificacao: notificacaoCliente,
    notificacaoCliente,
    notificacaoTransportadora,
    notificacaoRedespacho,
    notificacaoAgencia
  };
}

async function enviarWhatsappCarradaLote({ codigoCarrada: codigoCarradaParam, mensagemPersonalizada }) {
  const codigoCarrada = parseCodigoCarrada(codigoCarradaParam);
  const mensagemLivre = limparTexto(mensagemPersonalizada);

  if (!mensagemLivre) {
    throw criarErro('A mensagem personalizada é obrigatória.', 400);
  }

  const carrada = await buscarCarradaOuFalhar(codigoCarrada);
  const pedidos = Array.isArray(carrada?.pedidos) ? carrada.pedidos : [];

  const itens = [];
  let enviadosSucesso = 0;
  let semTelefone = 0;
  let comErro = 0;

  for (const pedido of pedidos) {
    const numeroPedido = normalizarNumeroPedido(pedido?.numero);
    const detalhePagamento = await buscarDetalhePagamentoDoPedido(pedido);
    const resumoPedido = montarResumoPedido(pedido, detalhePagamento);
    const telefone = normalizarTelefoneLote(pedido, detalhePagamento);
    const mensagem = montarMensagemWhatsappCarradaPedido({
      pedido: {
        numero: resumoPedido.numeroPedido,
        cliente: { nome: resumoPedido?.cliente?.nome || pedido?.cliente?.nome || '' }
      },
      carrada,
      mensagemPersonalizada: mensagemLivre
    });

    if (!telefone) {
      semTelefone += 1;
      itens.push({
        numeroPedido,
        nomeCliente: resumoPedido?.cliente?.nome || pedido?.cliente?.nome || '',
        telefone: '',
        status: 'sem_telefone'
      });
      continue;
    }

    try {
      await whatsappService.enviarMensagem({ telefone, mensagem });
      enviadosSucesso += 1;
      itens.push({
        numeroPedido,
        nomeCliente: resumoPedido?.cliente?.nome || pedido?.cliente?.nome || '',
        telefone,
        status: 'enviado'
      });
    } catch (error) {
      comErro += 1;
      itens.push({
        numeroPedido,
        nomeCliente: resumoPedido?.cliente?.nome || pedido?.cliente?.nome || '',
        telefone,
        status: 'erro',
        erro: error?.message || 'Erro ao enviar WhatsApp.'
      });
    }
  }

  return {
    codigoCarrada,
    totalPedidos: pedidos.length,
    enviadosSucesso,
    semTelefone,
    comErro,
    itens
  };
}

module.exports = {
  FASES_MATRIZ,
  buscarMatriz,
  buscarResumoListaCarradas,
  calcularQuantidadeVolumesPedido,
  salvarQuantidadeVolumesManual,
  salvarDataExpedicao,
  salvarFaseBooleana,
  buscarDadosEtiquetaPedido,
  enviarEtiquetaVolumes,
  confirmarEtiquetaVolumes,
  salvarLocalEntrega,
  perguntarRepeticaoLocalEntrega,
  enviarWhatsappCarradaLote
};
