const pool = require('../../../../db/connection');
const legadoBridgeService = require('../legadoBridge.service');
const pagamentosService = require('../pagamentos/pagamentos.service');

const STATUS_INCOMPLETA = 'incompleta';
const STATUS_SEMICOMPLETA = 'semicompleta';
const STATUS_COMPLETA = 'completa';
const STATUS_VALIDOS = new Set([STATUS_INCOMPLETA, STATUS_SEMICOMPLETA, STATUS_COMPLETA]);
const FASES_BOOLEANAS_CODIGOS = [
  'EM_PRODUCAO',
  'PEDIDO_PRONTO',
  'VIDEO_FEITO',
  'QUER_NOTA_FISCAL',
  'LOCAL_ENTREGA',
  'LIGACAO_POS_VENDA'
];

function criarErro(message, status = 400) {
  const error = new Error(message);
  error.statusCode = status;
  return error;
}

function parseCodigoCarrada(value) {
  const codigo = Number.parseInt(value, 10);

  if (!Number.isInteger(codigo) || codigo <= 0) {
    throw criarErro('Código da carrada inválido.', 400);
  }

  return codigo;
}

function limparTexto(value) {
  return String(value || '').trim();
}

async function garantirTabelaStatusResumo(client = pool) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS carradas_status_resumo (
      codigo_carrada INTEGER PRIMARY KEY,
      status_linha VARCHAR(20) NOT NULL CHECK (status_linha IN ('incompleta', 'semicompleta', 'completa')),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
}

async function tabelasProgressoExistem(client = pool) {
  const result = await client.query(`
    SELECT
      to_regclass('public.carradas_pedidos_fases') AS fases,
      to_regclass('public.carradas_pedidos_etiquetas_volumes') AS etiquetas_pedidos,
      to_regclass('public.carradas_pedidos_local_entrega') AS local_entrega
  `);

  const row = result.rows[0] || {};

  return Boolean(row.fases)
    && Boolean(row.etiquetas_pedidos)
    && Boolean(row.local_entrega);
}

async function buscarCarradaDoLegado(codigoCarrada) {
  const response = await legadoBridgeService.get(`/api/carradas/${codigoCarrada}`);
  return response?.dado || null;
}

function calcularPagamentoQuitado(detalhePagamento) {
  const saldo = Number(detalhePagamento?.resumo?.saldoRestante ?? 0);
  return saldo <= 0.009;
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
  const [localEntregaResult, silenciosoResult] = await Promise.all([
    pool.query(
      `
        SELECT numero_pedido
        FROM carradas_pedidos_local_entrega
        WHERE codigo_carrada = $1
          AND transportadora_id IS NOT NULL
      `,
      [codigoCarrada]
    ),
    pool.query(
      `
        SELECT numero_pedido
        FROM carradas_pedidos_fases
        WHERE codigo_carrada = $1
          AND fase_codigo = 'LOCAL_ENTREGA'
          AND valor_boolean = TRUE
      `,
      [codigoCarrada]
    )
  ]);

  return new Set([
    ...localEntregaResult.rows.map((row) => String(row.numero_pedido)),
    ...silenciosoResult.rows.map((row) => String(row.numero_pedido))
  ]);
}

async function salvarStatusLinha(codigoCarrada, statusLinha) {
  await garantirTabelaStatusResumo();

  const codigo = parseCodigoCarrada(codigoCarrada);
  const status = limparTexto(statusLinha).toLowerCase();

  if (!STATUS_VALIDOS.has(status)) {
    throw criarErro('Status da carrada inválido.', 400);
  }

  const result = await pool.query(
    `
      INSERT INTO carradas_status_resumo (codigo_carrada, status_linha, updated_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (codigo_carrada)
      DO UPDATE SET
        status_linha = EXCLUDED.status_linha,
        updated_at = NOW()
      RETURNING codigo_carrada, status_linha, updated_at
    `,
    [codigo, status]
  );

  return result.rows[0] || null;
}

async function excluirStatusCarrada(codigoCarrada) {
  await garantirTabelaStatusResumo();
  const codigo = parseCodigoCarrada(codigoCarrada);
  await pool.query(`DELETE FROM carradas_status_resumo WHERE codigo_carrada = $1`, [codigo]);
}

async function calcularStatusCarrada(codigoCarradaParam) {
  const codigoCarrada = parseCodigoCarrada(codigoCarradaParam);
  const carrada = await buscarCarradaDoLegado(codigoCarrada);

  if (!carrada) {
    throw criarErro('Carrada não encontrada.', 404);
  }

  const pedidos = Array.isArray(carrada?.pedidos) ? carrada.pedidos : [];

  if (!pedidos.length) {
    return {
      codigoCarrada,
      concluida: false,
      semicompleta: false,
      statusLinha: STATUS_INCOMPLETA,
      updatedAt: null
    };
  }

  const progressoExiste = await tabelasProgressoExistem();

  if (!progressoExiste) {
    return {
      codigoCarrada,
      concluida: false,
      semicompleta: false,
      statusLinha: STATUS_INCOMPLETA,
      updatedAt: null
    };
  }

  const [booleanMap, etiquetasSet, localEntregaSet] = await Promise.all([
    buscarResumoBooleanosConcluidosPorCarrada(codigoCarrada),
    buscarResumoEtiquetasConfirmadasPorCarrada(codigoCarrada),
    buscarResumoLocalEntregaPorCarrada(codigoCarrada)
  ]);

  const resumosPedidos = await Promise.all(
    pedidos.map(async (pedido) => {
      const numeroPedido = String(pedido?.numero || '');
      const booleanSet = booleanMap.get(numeroPedido) || new Set();
      const emProducao = booleanSet.has('EM_PRODUCAO');
      const pedidoPronto = booleanSet.has('PEDIDO_PRONTO');
      const videoFeito = booleanSet.has('VIDEO_FEITO');
      const querNotaFiscal = booleanSet.has('QUER_NOTA_FISCAL');
      const ligacaoPosVenda = booleanSet.has('LIGACAO_POS_VENDA');
      const etiquetaConcluida = etiquetasSet.has(numeroPedido);
      const localEntregaConcluido = localEntregaSet.has(numeroPedido);

      let pagamentoQuitado = false;

      if (pedido?.saida) {
        try {
          const detalhePagamento = await pagamentosService.buscarPedidoComPagamentos({
            empresa: pedido.empresa ?? -1,
            saida: pedido.saida,
            pdv: pedido.pdv ?? 0
          });
          pagamentoQuitado = calcularPagamentoQuitado(detalhePagamento);
        } catch (error) {
          pagamentoQuitado = false;
        }
      }

      const concluidasSemLigacao = [
        emProducao,
        pedidoPronto,
        etiquetaConcluida,
        videoFeito,
        querNotaFiscal,
        localEntregaConcluido,
        pagamentoQuitado
      ].every(Boolean);

      return {
        semLigacaoConcluido: concluidasSemLigacao,
        completo: concluidasSemLigacao && ligacaoPosVenda
      };
    })
  );

  const semicompleta = resumosPedidos.every((item) => item.semLigacaoConcluido);
  const concluida = resumosPedidos.every((item) => item.completo);
  const statusLinha = concluida
    ? STATUS_COMPLETA
    : (semicompleta ? STATUS_SEMICOMPLETA : STATUS_INCOMPLETA);

  return {
    codigoCarrada,
    concluida,
    semicompleta,
    statusLinha,
    updatedAt: null
  };
}

async function recalcularStatusCarrada(codigoCarradaParam) {
  const resumo = await calcularStatusCarrada(codigoCarradaParam);
  const salvo = await salvarStatusLinha(resumo.codigoCarrada, resumo.statusLinha);

  return {
    ...resumo,
    updatedAt: salvo?.updated_at || null
  };
}

function criarResumoPadrao(codigoCarrada, row = null) {
  const statusLinha = STATUS_VALIDOS.has(String(row?.status_linha || '').toLowerCase())
    ? String(row.status_linha).toLowerCase()
    : STATUS_INCOMPLETA;

  return {
    codigoCarrada,
    concluida: statusLinha === STATUS_COMPLETA,
    semicompleta: statusLinha === STATUS_SEMICOMPLETA,
    statusLinha,
    updatedAt: row?.updated_at || null
  };
}

async function buscarMapaStatusPorCodigos(codigosParam = []) {
  await garantirTabelaStatusResumo();

  const codigos = [...new Set(
    (Array.isArray(codigosParam) ? codigosParam : [])
      .map((codigo) => Number.parseInt(codigo, 10))
      .filter((codigo) => Number.isInteger(codigo) && codigo > 0)
  )];

  const mapa = new Map();

  if (!codigos.length) {
    return mapa;
  }

  const result = await pool.query(
    `
      SELECT codigo_carrada, status_linha, updated_at
      FROM carradas_status_resumo
      WHERE codigo_carrada = ANY($1::int[])
    `,
    [codigos]
  );

  const rowsMap = new Map(result.rows.map((row) => [Number(row.codigo_carrada), row]));

  codigos.forEach((codigo) => {
    mapa.set(codigo, criarResumoPadrao(codigo, rowsMap.get(codigo) || null));
  });

  return mapa;
}

async function listarResumoListaCarradasPersistido(codigosParam) {
  let codigos = Array.isArray(codigosParam)
    ? [...new Set(codigosParam.map((codigo) => Number.parseInt(codigo, 10)).filter((codigo) => Number.isInteger(codigo) && codigo > 0))]
    : [];

  if (!codigos.length) {
    const response = await legadoBridgeService.get('/api/carradas');
    const carradas = Array.isArray(response?.dados) ? response.dados : [];
    codigos = [...new Set(
      carradas
        .map((item) => Number.parseInt(item?.codigo, 10))
        .filter((codigo) => Number.isInteger(codigo) && codigo > 0)
    )];
  }

  const mapa = await buscarMapaStatusPorCodigos(codigos);
  return codigos.map((codigo) => mapa.get(codigo) || criarResumoPadrao(codigo)).sort((a, b) => a.codigoCarrada - b.codigoCarrada);
}

module.exports = {
  STATUS_INCOMPLETA,
  STATUS_SEMICOMPLETA,
  STATUS_COMPLETA,
  garantirTabelaStatusResumo,
  salvarStatusLinha,
  excluirStatusCarrada,
  recalcularStatusCarrada,
  buscarMapaStatusPorCodigos,
  listarResumoListaCarradasPersistido
};
