const firebirdService = require('../firebird.service');
const pedidosInsercaoService = require('../pedidos-insercao/pedidos-insercao.service');

function limparTexto(valor) {
  if (valor === undefined || valor === null) {
    return '';
  }

  return String(valor).trim();
}

function normalizarInteiroPositivo(valor, nomeCampo) {
  const numero = Number(valor);

  if (!Number.isInteger(numero) || numero <= 0) {
    throw new Error(`Campo inválido: ${nomeCampo}`);
  }

  return numero;
}

function normalizarNumeroPedido(valor) {
  const texto = limparTexto(valor);

  if (!texto) {
    throw new Error('Número do pedido inválido.');
  }

  return texto;
}

function mapCarrada(row) {
  return {
    codigo: row.codigo ?? null,
    data: row.data ?? null,
    descricao: limparTexto(row.motorista),
    analisado: limparTexto(row.analisado)
  };
}

async function buscarCarrada(codigoCarrada, tx = firebirdService) {
  const codigo = normalizarInteiroPositivo(codigoCarrada, 'carrada_codigo');
  const rows = await tx.query(
    `
      SELECT
        GC.CODIGO,
        GC.DATA,
        GC.MOTORISTA,
        GC.ANALISADO
      FROM GEORGE_CARRADA GC
      WHERE GC.CODIGO = ?
    `,
    [codigo]
  );

  return rows[0] ? mapCarrada(rows[0]) : null;
}

async function buscarSaidaPorNumero(numeroPedido, tx = firebirdService) {
  const numero = normalizarNumeroPedido(numeroPedido);
  const rows = await tx.query(
    `
      SELECT FIRST 1
        S.EMPRESA,
        S.SAIDA,
        S.PDV,
        S.NUMERO
      FROM SAIDAS S
      WHERE S.NUMERO = ?
      ORDER BY S.SAIDA DESC
    `,
    [numero]
  );

  return rows[0] || null;
}

async function pedidoJaVinculadoNaCarrada(codigoCarrada, numeroPedido, tx = firebirdService) {
  const codigo = normalizarInteiroPositivo(codigoCarrada, 'carrada_codigo');
  const numero = normalizarNumeroPedido(numeroPedido);

  const rows = await tx.query(
    `
      SELECT FIRST 1 GCP.CODIGO
      FROM GEORGE_CARRADA_PEDIDOS GCP
      WHERE GCP.CODIGO_CARRADA = ?
        AND GCP.NUMERO = ?
    `,
    [codigo, numero]
  );

  return Boolean(rows[0]?.codigo);
}

async function vincularPedidoNaCarrada(codigoCarrada, numeroPedido, volumes = 0) {
  const codigo = normalizarInteiroPositivo(codigoCarrada, 'carrada_codigo');
  const numero = normalizarNumeroPedido(numeroPedido);

  return firebirdService.withTransaction(async (tx) => {
    const carrada = await buscarCarrada(codigo, tx);

    if (!carrada) {
      throw new Error('Carrada não encontrada.');
    }

    const saida = await buscarSaidaPorNumero(numero, tx);

    if (!saida) {
      throw new Error(`Pedido ${numero} não encontrado no legado.`);
    }

    const jaVinculado = await pedidoJaVinculadoNaCarrada(codigo, numero, tx);

    if (!jaVinculado) {
      await tx.query(
        `
          INSERT INTO GEORGE_CARRADA_PEDIDOS (
            CODIGO,
            NUMERO,
            QTDE_VOLUME,
            CODIGO_CARRADA,
            OBSERVACAO,
            EMPRESA,
            SAIDA,
            PDV
          ) VALUES (NULL, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          numero,
          Number(volumes || 0),
          codigo,
          '',
          saida.empresa ?? -1,
          saida.saida,
          saida.pdv ?? 0
        ]
      );
    }

    return {
      sucesso: true,
      codigo: carrada.codigo,
      data: carrada.data,
      descricao: carrada.descricao,
      numero,
      jaVinculado
    };
  });
}

async function inserirPedido(payload = {}) {
  const carradaCodigoBruto = payload?.carrada_codigo ?? payload?.carradaCodigo ?? null;
  const carradaCodigo =
    carradaCodigoBruto === undefined || carradaCodigoBruto === null || String(carradaCodigoBruto).trim() === ''
      ? null
      : normalizarInteiroPositivo(carradaCodigoBruto, 'carrada_codigo');

  const payloadPedido = {
    ...payload
  };

  delete payloadPedido.carrada_codigo;
  delete payloadPedido.carradaCodigo;

  const pedido = await pedidosInsercaoService.inserirPedido(payloadPedido);

  let carradaVinculada = null;
  let aviso = null;

  if (carradaCodigo) {
    try {
      carradaVinculada = await vincularPedidoNaCarrada(carradaCodigo, pedido.numero, pedido.volumes);
    } catch (error) {
      carradaVinculada = {
        sucesso: false,
        codigo: carradaCodigo,
        erro: error.message
      };
      aviso = `Pedido salvo, mas não foi possível vincular à carrada ${carradaCodigo}: ${error.message}`;
    }
  }

  return {
    pedido,
    carradaVinculada,
    aviso
  };
}

module.exports = {
  inserirPedido
};
