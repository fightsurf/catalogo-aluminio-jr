const pool = require('../../../../db/connection');
const carradasService = require('../carradas/carradas.service');
const pagamentosService = require('../pagamentos/pagamentos.service');
const whatsappService = require('../../whatsapp/envio-whatsapp.service');
const carradasStatusResumoService = require('./carradas-status-resumo.service');

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
  }
};

const FASES_MATRIZ = [
  { codigo: 'EM_PRODUCAO', nome: 'Em produção', tipo: 'boolean' },
  { codigo: 'PEDIDO_PRONTO', nome: 'Pedido pronto', tipo: 'boolean' },
  { codigo: 'ETIQUETA_VOLUMES', nome: 'Etiqueta volumes', tipo: 'especial' },
  { codigo: 'VIDEO_FEITO', nome: 'Vídeo feito', tipo: 'boolean' },
  { codigo: 'QUER_NOTA_FISCAL', nome: 'Quer nota fiscal', tipo: 'boolean' },
  { codigo: 'LOCAL_ENTREGA', nome: 'Local de entrega', tipo: 'especial' },
  { codigo: 'PAGAMENTO_QUITADO', nome: 'Pagamento quitado', tipo: 'automatico' },
  { codigo: 'LIGACAO_POS_VENDA', nome: 'Ligação pós-venda', tipo: 'boolean' }
];

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

function encontrarPedidoNaCarrada(carrada, numeroPedido) {
  const pedido = (Array.isArray(carrada?.pedidos) ? carrada.pedidos : []).find(
    (item) => String(item?.numero) === String(numeroPedido)
  );

  if (!pedido) {
    throw criarErro(`O pedido ${numeroPedido} não pertence à carrada ${carrada?.codigo || ''}.`, 404);
  }

  return pedido;
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

async function buscarBooleanRows(codigoCarrada) {
  const result = await pool.query(
    `
      SELECT codigo_carrada, numero_pedido, saida, fase_codigo, valor_boolean, created_at, updated_at
      FROM carradas_pedidos_fases
      WHERE codigo_carrada = $1
    `,
    [codigoCarrada]
  );

  const mapa = new Map();

  result.rows.forEach((row) => {
    const numeroPedido = String(row.numero_pedido);

    if (!mapa.has(numeroPedido)) {
      mapa.set(numeroPedido, {});
    }

    mapa.get(numeroPedido)[String(row.fase_codigo).toUpperCase()] = {
      valorBoolean: Boolean(row.valor_boolean),
      saida: row.saida ?? null,
      createdAt: row.created_at || null,
      updatedAt: row.updated_at || null
    };
  });

  return mapa;
}

async function buscarEtiquetasRows(codigoCarrada) {
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
      WHERE p.codigo_carrada = $1
    `,
    [codigoCarrada]
  );

  const mapa = new Map();

  result.rows.forEach((row) => {
    mapa.set(String(row.numero_pedido), {
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

async function buscarLocalEntregaRows(codigoCarrada) {
  const result = await pool.query(
    `
      SELECT
        le.codigo_carrada,
        le.numero_pedido,
        le.saida,
        le.transportadora_id,
        le.agencia_cidade,
        le.created_at,
        le.updated_at,
        t.nome AS transportadora_nome,
        t.telefone AS transportadora_telefone
      FROM carradas_pedidos_local_entrega le
      INNER JOIN transportadoras t ON t.id = le.transportadora_id
      WHERE le.codigo_carrada = $1
    `,
    [codigoCarrada]
  );

  const mapa = new Map();

  result.rows.forEach((row) => {
    mapa.set(String(row.numero_pedido), {
      codigoCarrada: row.codigo_carrada,
      numeroPedido: row.numero_pedido,
      saida: row.saida,
      transportadoraId: row.transportadora_id,
      agenciaCidade: row.agencia_cidade || '',
      transportadoraNome: row.transportadora_nome || '',
      transportadoraTelefone: row.transportadora_telefone || '',
      createdAt: row.created_at,
      updatedAt: row.updated_at
    });
  });

  return mapa;
}

function montarFasesDoPedido({ pedido, booleanRows = {}, etiquetaRow = null, localEntregaRow = null, detalhePagamento = null }) {
  const faseEmProducao = Boolean(booleanRows.EM_PRODUCAO?.valorBoolean);
  const fasePedidoPronto = Boolean(booleanRows.PEDIDO_PRONTO?.valorBoolean);
  const faseVideoFeito = Boolean(booleanRows.VIDEO_FEITO?.valorBoolean);
  const faseQuerNotaFiscal = Boolean(booleanRows.QUER_NOTA_FISCAL?.valorBoolean);
  const faseLocalEntregaSilencioso = Boolean(booleanRows.LOCAL_ENTREGA?.valorBoolean);
  const faseLigacaoPosVenda = Boolean(booleanRows.LIGACAO_POS_VENDA?.valorBoolean);
  const etiquetaSilenciosa = Boolean(booleanRows.ETIQUETA_VOLUMES?.valorBoolean);
  const etiquetaConfirmada = Boolean(etiquetaRow?.confirmadoBoolean) || etiquetaSilenciosa;
  const localEntregaDefinido = Boolean(localEntregaRow?.transportadoraId) || faseLocalEntregaSilencioso;
  const pagamentoQuitado = calcularPagamentoQuitado(detalhePagamento);

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
      agenciaCidade: localEntregaRow?.agenciaCidade || '',
      marcadoSilencioso: faseLocalEntregaSilencioso,
      updatedAt: localEntregaRow?.updatedAt || booleanRows.LOCAL_ENTREGA?.updatedAt || null
    },
    PAGAMENTO_QUITADO: {
      codigo: 'PAGAMENTO_QUITADO',
      concluido: pagamentoQuitado,
      tipo: 'automatico',
      totalPago: Number(detalhePagamento?.resumo?.totalPago ?? 0),
      saldoRestante: Number(detalhePagamento?.resumo?.saldoRestante ?? 0)
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
    buscarBooleanRows(codigoCarrada),
    buscarEtiquetasRows(codigoCarrada),
    buscarLocalEntregaRows(codigoCarrada)
  ]);

  const pagamentoEntries = await Promise.all(
    pedidos.map(async (pedido) => [String(pedido.numero), await buscarDetalhePagamentoDoPedido(pedido)])
  );
  const pagamentoMap = new Map(pagamentoEntries);

  const linhas = pedidos.map((pedido) => {
    const numeroPedido = String(pedido.numero);
    const detalhePagamento = pagamentoMap.get(numeroPedido) || null;
    const resumoPedido = montarResumoPedido(pedido, detalhePagamento);
    const fases = montarFasesDoPedido({
      pedido,
      booleanRows: booleanRowsMap.get(numeroPedido) || {},
      etiquetaRow: etiquetasMap.get(numeroPedido) || null,
      localEntregaRow: localEntregaMap.get(numeroPedido) || null,
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


async function buscarResumoBooleanosConcluidosPorCarrada(codigoCarrada) {
  const result = await pool.query(
    `
      SELECT numero_pedido, fase_codigo
      FROM carradas_pedidos_fases
      WHERE codigo_carrada = $1
        AND valor_boolean = TRUE
        AND fase_codigo = ANY($2::text[])
    `,
    [codigoCarrada, FASES_BOOLEANAS_CODIGOS]
  );

  const mapa = new Map();

  result.rows.forEach((row) => {
    const numeroPedido = String(row.numero_pedido);
    const faseCodigo = String(row.fase_codigo || '').toUpperCase();

    if (!mapa.has(numeroPedido)) {
      mapa.set(numeroPedido, new Set());
    }

    mapa.get(numeroPedido).add(faseCodigo);
  });

  return mapa;
}

async function buscarResumoEtiquetasConfirmadasPorCarrada(codigoCarrada) {
  const [etiquetasResult, silenciosoResult] = await Promise.all([
    pool.query(
      `
        SELECT numero_pedido
        FROM carradas_pedidos_etiquetas_volumes
        WHERE codigo_carrada = $1
          AND confirmado_boolean = TRUE
      `,
      [codigoCarrada]
    ),
    pool.query(
      `
        SELECT numero_pedido
        FROM carradas_pedidos_fases
        WHERE codigo_carrada = $1
          AND fase_codigo = 'ETIQUETA_VOLUMES'
          AND valor_boolean = TRUE
      `,
      [codigoCarrada]
    )
  ]);

  return new Set([
    ...etiquetasResult.rows.map((row) => String(row.numero_pedido)),
    ...silenciosoResult.rows.map((row) => String(row.numero_pedido))
  ]);
}

async function buscarResumoLocalEntregaPorCarrada(codigoCarrada) {
  const result = await pool.query(
    `
      SELECT numero_pedido
      FROM carradas_pedidos_local_entrega
      WHERE codigo_carrada = $1
        AND transportadora_id IS NOT NULL
    `,
    [codigoCarrada]
  );

  return new Set(result.rows.map((row) => String(row.numero_pedido)));
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
    buscarResumoBooleanosConcluidosPorCarrada(codigoCarrada),
    buscarResumoEtiquetasConfirmadasPorCarrada(codigoCarrada),
    buscarResumoLocalEntregaPorCarrada(codigoCarrada)
  ]);

  const resumosPedidos = await mapearComConcorrencia(pedidos, 6, async (pedido) => {
    const numeroPedido = String(pedido?.numero || '');
    const booleanSet = booleanMap.get(numeroPedido) || new Set();
    const emProducao = booleanSet.has('EM_PRODUCAO');
    const pedidoPronto = booleanSet.has('PEDIDO_PRONTO');
    const videoFeito = booleanSet.has('VIDEO_FEITO');
    const querNotaFiscal = booleanSet.has('QUER_NOTA_FISCAL');
    const ligacaoPosVenda = booleanSet.has('LIGACAO_POS_VENDA');
    const etiquetaConcluida = etiquetasSet.has(numeroPedido);
    const localEntregaConcluido = localEntregaSet.has(numeroPedido) || booleanSet.has('LOCAL_ENTREGA');
    const detalhePagamento = await buscarDetalhePagamentoDoPedido(pedido);
    const pagamentoQuitado = calcularPagamentoQuitado(detalhePagamento);

    const concluidasSemLigacao = [
      emProducao,
      pedidoPronto,
      etiquetaConcluida,
      videoFeito,
      querNotaFiscal,
      localEntregaConcluido,
      pagamentoQuitado
    ].filter(Boolean).length;

    return {
      semLigacaoConcluido: concluidasSemLigacao === 7,
      completo: concluidasSemLigacao === 7 && ligacaoPosVenda,
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
    [codigoCarrada, numeroPedido, pedido.saida ?? null, faseCodigo, valorBoolean]
  );

  return result.rows[0] || null;
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

  const anteriorResult = await pool.query(
    `
      SELECT valor_boolean
      FROM carradas_pedidos_fases
      WHERE codigo_carrada = $1
        AND numero_pedido = $2
        AND fase_codigo = $3
    `,
    [codigoCarrada, numeroPedido, faseCodigo]
  );

  const valorAnterior = anteriorResult.rows.length ? Boolean(anteriorResult.rows[0].valor_boolean) : false;

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
    [codigoCarrada, numeroPedido, pedido.saida ?? null, faseCodigo, valorBoolean]
  );

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
      concluido: Boolean(result.rows[0]?.valor_boolean),
      updatedAt: result.rows[0]?.updated_at || null
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
      WHERE p.codigo_carrada = $1
        AND p.numero_pedido = $2
    `,
    [codigoCarrada, numeroPedido]
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
    [codigoCarrada, numeroPedido, pedido.saida ?? null, etiqueta.id, textoSnapshot]
  );

  await pool.query(
    `
      DELETE FROM carradas_pedidos_fases
      WHERE codigo_carrada = $1
        AND numero_pedido = $2
        AND fase_codigo = 'ETIQUETA_VOLUMES'
    `,
    [codigoCarrada, numeroPedido]
  );

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

  const result = await pool.query(
    `
      UPDATE carradas_pedidos_etiquetas_volumes
      SET confirmado_boolean = $3,
          confirmado_em = CASE WHEN $3 THEN NOW() ELSE NULL END,
          updated_at = NOW()
      WHERE codigo_carrada = $1
        AND numero_pedido = $2
      RETURNING codigo_carrada, numero_pedido, etiqueta_cliente_id, texto_snapshot, confirmado_boolean, enviado_em, confirmado_em, updated_at
    `,
    [codigoCarrada, numeroPedido, confirmadoBoolean]
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

  await pool.query(
    `
      DELETE FROM carradas_pedidos_fases
      WHERE codigo_carrada = $1
        AND numero_pedido = $2
        AND fase_codigo = 'ETIQUETA_VOLUMES'
    `,
    [codigoCarrada, numeroPedido]
  );

  await carradasStatusResumoService.recalcularStatusCarrada(codigoCarrada);

  return {
    numeroPedido,
    confirmadoBoolean: Boolean(result.rows[0].confirmado_boolean),
    enviadoEm: result.rows[0].enviado_em || null,
    confirmadoEm: result.rows[0].confirmado_em || null,
    updatedAt: result.rows[0].updated_at || null
  };
}

async function salvarLocalEntrega({ codigoCarrada: codigoCarradaParam, numeroPedido: numeroPedidoParam, transportadoraId, agenciaCidade }) {
  await garantirTabelasModulo();

  const codigoCarrada = parseCodigoCarrada(codigoCarradaParam);
  const numeroPedido = normalizarNumeroPedido(numeroPedidoParam);
  const carrada = await carradasService.buscarResumoCarrada(codigoCarrada);

  if (!carrada) {
    throw criarErro('Carrada não encontrada.', 404);
  }
  const pedido = encontrarPedidoNaCarrada(carrada, numeroPedido);

  if (transportadoraId === null || transportadoraId === undefined || transportadoraId === '') {
    await pool.query(
      `DELETE FROM carradas_pedidos_local_entrega WHERE codigo_carrada = $1 AND numero_pedido = $2`,
      [codigoCarrada, numeroPedido]
    );

    await pool.query(
      `DELETE FROM carradas_pedidos_fases WHERE codigo_carrada = $1 AND numero_pedido = $2 AND fase_codigo = 'LOCAL_ENTREGA'`,
      [codigoCarrada, numeroPedido]
    );

    await carradasStatusResumoService.recalcularStatusCarrada(codigoCarrada);

    return {
      numeroPedido,
      concluido: false,
      transportadoraId: null,
      transportadoraNome: '',
      agenciaCidade: ''
    };
  }

  const transportadoraIdInt = Number.parseInt(transportadoraId, 10);

  if (!Number.isInteger(transportadoraIdInt) || transportadoraIdInt <= 0) {
    throw criarErro('Transportadora inválida.', 400);
  }

  const transportadoraResult = await pool.query(
    `SELECT id, nome, telefone FROM transportadoras WHERE id = $1`,
    [transportadoraIdInt]
  );

  const transportadora = transportadoraResult.rows[0];

  if (!transportadora) {
    throw criarErro('Transportadora não encontrada.', 404);
  }

  const agenciaCidadeNormalizada = limparTexto(agenciaCidade) || null;

  const result = await pool.query(
    `
      INSERT INTO carradas_pedidos_local_entrega (
        codigo_carrada,
        numero_pedido,
        saida,
        transportadora_id,
        agencia_cidade
      ) VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (codigo_carrada, numero_pedido)
      DO UPDATE SET
        saida = EXCLUDED.saida,
        transportadora_id = EXCLUDED.transportadora_id,
        agencia_cidade = EXCLUDED.agencia_cidade,
        updated_at = NOW()
      RETURNING codigo_carrada, numero_pedido, saida, transportadora_id, agencia_cidade, updated_at
    `,
    [codigoCarrada, numeroPedido, pedido.saida ?? null, transportadoraIdInt, agenciaCidadeNormalizada]
  );

  await pool.query(
    `DELETE FROM carradas_pedidos_fases WHERE codigo_carrada = $1 AND numero_pedido = $2 AND fase_codigo = 'LOCAL_ENTREGA'`,
    [codigoCarrada, numeroPedido]
  );

  await carradasStatusResumoService.recalcularStatusCarrada(codigoCarrada);

  return {
    numeroPedido,
    concluido: true,
    transportadoraId: result.rows[0].transportadora_id,
    transportadoraNome: transportadora.nome || '',
    transportadoraTelefone: transportadora.telefone || '',
    agenciaCidade: result.rows[0].agencia_cidade || '',
    updatedAt: result.rows[0].updated_at || null
  };
}

module.exports = {
  FASES_MATRIZ,
  buscarMatriz,
  buscarResumoListaCarradas,
  salvarFaseBooleana,
  buscarDadosEtiquetaPedido,
  enviarEtiquetaVolumes,
  confirmarEtiquetaVolumes,
  salvarLocalEntrega
};
