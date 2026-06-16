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

  const numero = limparTexto(row?.numero_pedido || row?.numero);
  return numero ? indicePedidos.porNumero.get(numero) || '' : '';
}

function linhaMaisNovaQueAtual(novaLinha, linhaAtual) {
  if (!linhaAtual) {
    return true;
  }

  const novaData = new Date(novaLinha?.updated_at || novaLinha?.updatedAt || novaLinha?.created_at || novaLinha?.createdAt || 0).getTime();
  const atualData = new Date(linhaAtual?.updated_at || linhaAtual?.updatedAt || linhaAtual?.created_at || linhaAtual?.createdAt || 0).getTime();

  return novaData >= atualData;
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
    buscarResumoBooleanosConcluidosDosPedidos(pedidos),
    buscarResumoEtiquetasConfirmadasDosPedidos(pedidos),
    buscarResumoLocalEntregaDosPedidos(pedidos)
  ]);

  const resumosPedidos = await Promise.all(
    pedidos.map(async (pedido) => {
      const numeroPedido = String(pedido?.numero || '');
      const chavePedido = criarChavePedido({ saida: pedido?.saida, numero: numeroPedido });
      const booleanSet = booleanMap.get(chavePedido) || new Set();
      const emProducao = booleanSet.has('EM_PRODUCAO');
      const pedidoPronto = booleanSet.has('PEDIDO_PRONTO');
      const videoFeito = booleanSet.has('VIDEO_FEITO');
      const querNotaFiscal = booleanSet.has('QUER_NOTA_FISCAL');
      const ligacaoPosVenda = booleanSet.has('LIGACAO_POS_VENDA');
      const etiquetaConcluida = etiquetasSet.has(chavePedido);
      const localEntregaConcluido = localEntregaSet.has(chavePedido);

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
