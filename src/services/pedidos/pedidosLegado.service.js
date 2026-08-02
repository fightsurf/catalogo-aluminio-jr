const firebirdService = require('../firebird.service');

function textoOuVazio(valor) {
  return String(valor || '').trim();
}

function normalizarInteiroPositivo(valor, nomeCampo) {
  const numero = Number.parseInt(valor, 10);

  if (!Number.isInteger(numero) || numero <= 0) {
    throw new Error(`Campo inválido: ${nomeCampo}`);
  }

  return numero;
}

function normalizarInteiroNaoNegativo(valor, nomeCampo) {
  const numero = Number(valor);

  if (!Number.isInteger(numero) || numero < 0) {
    throw new Error(`Campo inválido: ${nomeCampo}`);
  }

  return numero;
}

function normalizarNumero(valor, nomeCampo) {
  const numero = Number(String(valor).replace(',', '.'));

  if (!Number.isFinite(numero)) {
    throw new Error(`Campo inválido: ${nomeCampo}`);
  }

  return numero;
}

function arredondarNumero(valor, casas = 6) {
  const fator = 10 ** casas;
  return Math.round(Number(valor || 0) * fator) / fator;
}

function normalizarItensEdicao(itens) {
  if (!Array.isArray(itens) || !itens.length) {
    throw new Error('Informe ao menos 1 item para o pedido.');
  }

  return itens.map((item, index) => {
    const codigoItem = normalizarInteiroPositivo(item?.item, `itens[${index}].item`);
    const quantidade = normalizarNumero(item?.quantidade, `itens[${index}].quantidade`);
    const preco = normalizarNumero(item?.preco, `itens[${index}].preco`);
    const descricao = textoOuVazio(item?.descricao);

    if (quantidade <= 0) {
      throw new Error(`Item ${index + 1}: quantidade deve ser maior que zero.`);
    }

    if (preco < 0) {
      throw new Error(`Item ${index + 1}: preço não pode ser negativo.`);
    }

    return {
      item: codigoItem,
      descricao: descricao || null,
      quantidade: arredondarNumero(quantidade),
      preco: arredondarNumero(preco, 3),
      subtotalitem: arredondarNumero(quantidade * preco)
    };
  });
}

function normalizarCodigoCarrada(valor) {
  if (valor === undefined || valor === null || `${valor}`.trim() === '') {
    return null;
  }

  return normalizarInteiroPositivo(valor, 'codigoCarrada');
}

function normalizeCst(value) {
  if (!value) return '000';
  const text = String(value).trim();
  if (!text) return '000';
  return text.length >= 3 ? text : text.padStart(3, '0');
}

function normalizeCst2(value, fallback) {
  if (!value) return fallback;
  const text = String(value).trim();
  if (!text) return fallback;
  return text.length >= 2 ? text : text.padStart(2, '0');
}

async function gerarIdGlobal(tx) {
  const rows = await tx.query('select gen_id(GEN_IDGLOBAL, 1) as id from rdb$database');
  return Number(rows?.[0]?.id || 0);
}

async function buscarItemCadastro(tx, itemId) {
  const rows = await tx.query(
    `
      select
        item,
        descricao,
        unidade,
        cst,
        reducaocst,
        aliqicms,
        situacaoecf,
        idtribfederal,
        cstpiscofinssaida,
        cstpiscofins,
        cstipi
      from itens
      where item = ?
    `,
    [itemId]
  );

  if (!rows.length) {
    throw new Error(`Item ${itemId} não encontrado no legado.`);
  }

  return rows[0];
}

function mapPedidoBase(row) {
  return {
    idMestre: row.IDMESTRE ?? row.idmestre,
    saida: row.SAIDA ?? row.saida ?? row.IDMESTRE ?? row.idmestre,
    numero: row.NUMERO ?? row.numero,
    data: row.DATA ?? row.data,
    total: Number(row.TOTAL ?? row.total ?? 0),
    obs: row.OBS ?? row.obs,
    empresa: row.EMPRESA ?? row.empresa ?? -1,
    pdv: row.PDV ?? row.pdv ?? 0,
    situacao: row.SITUACAO ?? row.situacao ?? '',
    volumes: Number(row.VOLUMES ?? row.volumes ?? 0),
    vendedor: {
      favorecido: row.VENDEDOR ?? row.vendedor,
      nome: row.V_NOME ?? row.v_nome
    },
    cliente: {
      nome: row.F_NOME ?? row.f_nome,
      cidade: row.F_CIDADE ?? row.f_cidade,
      uf: row.F_UF ?? row.f_uf,
      telefonePrincipal: row.F_TELEFONE_PRINCIPAL ?? row.f_telefone_principal
    }
  };
}

function mapItemPedido(row) {
  const quantidade = Number(row.QUANTIDADE ?? row.quantidade ?? 0);
  const preco = Number(row.PRECO ?? row.preco ?? 0);
  const subtotal = Number(row.SUBTOTALITEM ?? row.subtotalitem ?? quantidade * preco);

  return {
    saidaItem: row.SAIDAITEM ?? row.saidaitem ?? null,
    sequencia: row.SEQUENCIA ?? row.sequencia ?? null,
    item: row.ITEM ?? row.item ?? null,
    descricao: row.DESCRICAO ?? row.descricao,
    quantidade,
    preco,
    subtotal
  };
}

function mapCarradaAtual(row) {
  if (!row) {
    return null;
  }

  const codigo = row.CODIGO ?? row.codigo;
  if (!codigo) {
    return null;
  }

  return {
    codigo,
    data: row.DATA ?? row.data ?? null,
    descricao: textoOuVazio(row.DESCRICAO ?? row.descricao)
  };
}

async function buscarCarradaAtualDoPedido(numeroPedido, executor = firebirdService) {
  const numero = textoOuVazio(numeroPedido);

  if (!numero) {
    return null;
  }

  const rows = await executor.query(
    `
      SELECT FIRST 1
        G.CODIGO,
        G.DATA,
        TRIM(COALESCE(G.MOTORISTA, '')) AS DESCRICAO
      FROM GEORGE_CARRADA_PEDIDOS GCP
      INNER JOIN GEORGE_CARRADA G
        ON G.CODIGO = GCP.CODIGO_CARRADA
      WHERE GCP.NUMERO = ?
      ORDER BY G.CODIGO DESC
    `,
    [numero]
  );

  return mapCarradaAtual(rows[0]);
}

async function pesquisarPedidos(filtros = {}) {
  const numero = textoOuVazio(filtros.numero);
  const cliente = textoOuVazio(filtros.cliente);
  const data = textoOuVazio(filtros.data);

  let sql = `
    SELECT
      T.SAIDA AS IDMESTRE,
      T.SAIDA,
      T.EMPRESA,
      T.PDV,
      T.NUMERO,
      T.DATA,
      T.TOTAL,
      T.OBS,
      T.VENDEDOR,
      T.SITUACAO,
      T.VOLUMES,
      F.NOME AS F_NOME,
      F.RAZAO AS F_RAZAO,
      F.CIDADE AS F_CIDADE,
      F.UF AS F_UF,
      F.FONE1 AS F_TELEFONE_PRINCIPAL,
      V.NOME AS V_NOME
    FROM SAIDAS T
    LEFT JOIN FAVORECIDOS F ON F.FAVORECIDO = T.FAVORECIDO
    LEFT JOIN FAVORECIDOS V ON V.FAVORECIDO = T.VENDEDOR
    WHERE T.TIPOPADRAO = 1
  `;

  const params = [];

  if (numero) {
    sql += ` AND UPPER(T.NUMERO) LIKE ? `;
    params.push(`${numero.toUpperCase()}%`);
  }

  if (cliente) {
    sql += ` AND (
      UPPER(F.NOME) LIKE ?
      OR UPPER(COALESCE(F.RAZAO, '')) LIKE ?
    ) `;
    params.push(`%${cliente.toUpperCase()}%`);
    params.push(`%${cliente.toUpperCase()}%`);
  }

  if (data) {
    sql += ` AND CAST(T.DATA AS DATE) = CAST(? AS DATE) `;
    params.push(data);
  }

  sql += ` ORDER BY T.DATA DESC, T.NUMERO DESC `;

  return firebirdService.query(sql, params);
}

async function buscarPedidoPorId(idMestre, executor = firebirdService) {
  const id = normalizarInteiroPositivo(idMestre, 'idMestre');

  const sql = `
    SELECT
      T.SAIDA AS IDMESTRE,
      T.SAIDA,
      T.EMPRESA,
      T.PDV,
      T.NUMERO,
      T.DATA,
      T.TOTAL,
      T.OBS,
      T.VENDEDOR,
      T.SITUACAO,
      T.VOLUMES,
      F.NOME AS F_NOME,
      F.RAZAO AS F_RAZAO,
      F.CIDADE AS F_CIDADE,
      F.UF AS F_UF,
      F.FONE1 AS F_TELEFONE_PRINCIPAL,
      V.NOME AS V_NOME
    FROM SAIDAS T
    LEFT JOIN FAVORECIDOS F ON F.FAVORECIDO = T.FAVORECIDO
    LEFT JOIN FAVORECIDOS V ON V.FAVORECIDO = T.VENDEDOR
    WHERE T.SAIDA = ?
  `;

  const rows = await executor.query(sql, [id]);
  return rows[0] || null;
}

async function buscarItensPedido(idMestre, executor = firebirdService) {
  const id = normalizarInteiroPositivo(idMestre, 'idMestre');

  const sql = `
    SELECT
      T.SAIDAITEM,
      T.SEQUENCIA,
      T.ITEM,
      T.DESCRICAO,
      T.QUANTIDADE,
      T.PRECO,
      T.SUBTOTALITEM
    FROM SAIDASITENS T
    WHERE T.SAIDA = ?
    ORDER BY T.SEQUENCIA
  `;

  const rows = await executor.query(sql, [id]);
  return rows.map(mapItemPedido);
}

async function buscarCarradaPorCodigo(codigoCarrada, executor = firebirdService) {
  const codigo = normalizarInteiroPositivo(codigoCarrada, 'codigoCarrada');

  const rows = await executor.query(
    `
      SELECT FIRST 1
        G.CODIGO,
        G.DATA,
        TRIM(COALESCE(G.MOTORISTA, '')) AS DESCRICAO
      FROM GEORGE_CARRADA G
      WHERE G.CODIGO = ?
    `,
    [codigo]
  );

  return mapCarradaAtual(rows[0]);
}


function criarDataLimiteCarradasDisponiveis(diasParaTras = 15) {
  const data = new Date();
  data.setHours(0, 0, 0, 0);
  data.setDate(data.getDate() - diasParaTras);
  return data;
}

async function listarCarradasDisponiveisParaPedido(idMestre, executor = firebirdService) {
  const pedidoRow = await buscarPedidoPorId(idMestre, executor);

  if (!pedidoRow) {
    throw new Error('Pedido não encontrado.');
  }

  const pedido = mapPedidoBase(pedidoRow);
  const carradaAtual = await buscarCarradaAtualDoPedido(pedido.numero, executor);
  const dataLimite = criarDataLimiteCarradasDisponiveis(15);

  const rows = await executor.query(
    `
      SELECT
        G.CODIGO,
        G.DATA,
        TRIM(COALESCE(G.MOTORISTA, '')) AS DESCRICAO
      FROM GEORGE_CARRADA G
      WHERE G.DATA >= ?
      ORDER BY G.DATA ASC, G.CODIGO ASC
    `,
    [dataLimite]
  );

  const carradas = rows
    .map(mapCarradaAtual)
    .filter(Boolean);

  if (carradaAtual && !carradas.some((item) => Number(item.codigo) === Number(carradaAtual.codigo))) {
    carradas.unshift(carradaAtual);
  }

  return {
    carradaAtual,
    carradas
  };
}

async function substituirCarradaDoPedido(tx, pedidoAtual, codigoCarrada) {
  const numeroPedido = textoOuVazio(pedidoAtual?.numero);

  if (!numeroPedido) {
    throw new Error('Pedido sem número válido para atualização de carrada.');
  }

  const carradaAtual = await buscarCarradaAtualDoPedido(numeroPedido, tx);

  if (!codigoCarrada) {
    await tx.query(
      `DELETE FROM GEORGE_CARRADA_PEDIDOS WHERE NUMERO = ?`,
      [numeroPedido]
    );
    return null;
  }

  const carradaDestino = await buscarCarradaPorCodigo(codigoCarrada, tx);

  if (!carradaDestino) {
    throw new Error('Carrada selecionada não encontrada.');
  }

  if (Number(carradaAtual?.codigo || 0) !== Number(codigoCarrada)) {
    await tx.query(
      `DELETE FROM GEORGE_CARRADA_PEDIDOS WHERE NUMERO = ?`,
      [numeroPedido]
    );

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
        numeroPedido,
        Number(pedidoAtual?.volumes || 0),
        codigoCarrada,
        '',
        pedidoAtual?.empresa ?? -1,
        pedidoAtual?.saida,
        pedidoAtual?.pdv ?? 0
      ]
    );
  }

  return carradaDestino;
}

async function inserirItemPedido(tx, pedidoAtual, itemPayload, sequencia) {
  const cadastro = await buscarItemCadastro(tx, itemPayload.item);
  const saidaItem = await gerarIdGlobal(tx);
  const descricao = itemPayload.descricao || cadastro.descricao;

  if (!descricao) {
    throw new Error(`Item ${itemPayload.item} sem descrição para gravar.`);
  }

  const sql = `
    INSERT INTO SAIDASITENS (
      EMPRESA,
      PDV,
      SAIDAITEM,
      SAIDA,
      SEQUENCIA,
      DESCRICAO,
      QUANTIDADE,
      PRECO,
      ITEM,
      SUBTOTALITEM,
      ORDEM,
      STATUS,
      UNIDADE,
      FATOR,
      BAIXAESTOQUE,
      BASECALCICMSPROD,
      VALORICMSPROD,
      ALIQICMS,
      CST,
      REDUCAOCST,
      SITUACAOECF,
      BAIXAESTOQUEFISCAL,
      IDTRIBFEDERAL,
      CSTPISCOFINS,
      CSTIPI
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
  `;

  const params = [
    pedidoAtual?.empresa ?? -1,
    pedidoAtual?.pdv ?? 0,
    saidaItem,
    pedidoAtual?.saida,
    sequencia,
    descricao,
    itemPayload.quantidade,
    itemPayload.preco,
    itemPayload.item,
    itemPayload.subtotalitem,
    sequencia,
    'N',
    cadastro.unidade || 'Un',
    1,
    'N',
    0,
    0,
    Number(cadastro.aliqicms || 0),
    normalizeCst(cadastro.cst),
    Number(cadastro.reducaocst || 0),
    cadastro.situacaoecf || 'T',
    'N',
    Number(cadastro.idtribfederal || 0),
    normalizeCst2(cadastro.cstpiscofinssaida || cadastro.cstpiscofins, '04'),
    normalizeCst2(cadastro.cstipi, '52')
  ];

  await tx.query(sql, params);
}

async function buscarDetalheEdicaoPedido(idMestre, executor = firebirdService) {
  const pedidoRow = await buscarPedidoPorId(idMestre, executor);

  if (!pedidoRow) {
    return null;
  }

  const pedido = mapPedidoBase(pedidoRow);
  const itens = await buscarItensPedido(idMestre, executor);
  const carradaAtual = await buscarCarradaAtualDoPedido(pedido.numero, executor);

  return {
    ...pedido,
    carradaAtual,
    itens
  };
}


async function alterarCarradaPedido(idMestre, payload = {}) {
  const id = normalizarInteiroPositivo(idMestre, 'idMestre');
  const codigoCarrada = normalizarCodigoCarrada(payload?.codigoCarrada);

  return firebirdService.withTransaction(async (tx) => {
    const pedidoRow = await buscarPedidoPorId(id, tx);

    if (!pedidoRow) {
      throw new Error('Pedido não encontrado.');
    }

    const pedidoAtual = mapPedidoBase(pedidoRow);

    if (textoOuVazio(pedidoAtual?.situacao).toUpperCase() === 'C') {
      throw new Error('Pedido cancelado não pode ter carrada alterada.');
    }

    const carradaAnterior = await buscarCarradaAtualDoPedido(pedidoAtual.numero, tx);
    const carradaAtual = await substituirCarradaDoPedido(tx, pedidoAtual, codigoCarrada);
    const pedidoAtualizadoRow = await buscarPedidoPorId(id, tx);
    const pedidoAtualizado = mapPedidoBase(pedidoAtualizadoRow);

    return {
      pedido: {
        ...pedidoAtualizado,
        carradaAtual
      },
      carradaAnterior,
      carradaAtual
    };
  });
}

async function atualizarVolumesPedido(idMestre, volumesInformados) {
  const id = normalizarInteiroPositivo(idMestre, 'idMestre');
  const volumes = normalizarInteiroNaoNegativo(volumesInformados, 'volumes');

  return firebirdService.withTransaction(async (tx) => {
    const pedidoRow = await buscarPedidoPorId(id, tx);

    if (!pedidoRow) {
      throw new Error('Pedido não encontrado.');
    }

    const pedidoAtual = mapPedidoBase(pedidoRow);

    if (textoOuVazio(pedidoAtual?.situacao).toUpperCase() === 'C') {
      throw new Error('Pedido cancelado não pode ter os volumes atualizados.');
    }

    await tx.query(
      `UPDATE SAIDAS SET VOLUMES = ? WHERE SAIDA = ?`,
      [volumes, id]
    );

    await tx.query(
      `
        UPDATE GEORGE_CARRADA_PEDIDOS
        SET QTDE_VOLUME = ?
        WHERE SAIDA = ? OR NUMERO = ?
      `,
      [volumes, id, pedidoAtual.numero]
    );

    const pedidoAtualizado = await buscarDetalheEdicaoPedido(id, tx);

    return {
      idMestre: pedidoAtualizado?.idMestre ?? id,
      saida: pedidoAtualizado?.saida ?? id,
      numero: pedidoAtualizado?.numero ?? pedidoAtual.numero,
      volumes: Number(pedidoAtualizado?.volumes ?? volumes)
    };
  });
}


async function atualizarPedido(idMestre, payload = {}) {
  const id = normalizarInteiroPositivo(idMestre, 'idMestre');
  const vendedor = normalizarInteiroPositivo(payload?.vendedor, 'vendedor');
  const obs = textoOuVazio(payload?.obs) || null;
  const deveAtualizarCarrada = Object.prototype.hasOwnProperty.call(payload || {}, 'codigoCarrada');
  const codigoCarrada = deveAtualizarCarrada ? normalizarCodigoCarrada(payload?.codigoCarrada) : null;
  const itens = normalizarItensEdicao(payload?.itens);
  const total = arredondarNumero(
    itens.reduce((acc, item) => acc + Number(item.subtotalitem || 0), 0)
  );

  return firebirdService.withTransaction(async (tx) => {
    const pedidoRow = await buscarPedidoPorId(id, tx);

    if (!pedidoRow) {
      throw new Error('Pedido não encontrado.');
    }

    const pedidoAtual = mapPedidoBase(pedidoRow);

    if (textoOuVazio(pedidoAtual?.situacao).toUpperCase() === 'C') {
      throw new Error('Pedido cancelado não pode ser alterado.');
    }

    await tx.query(
      `
        UPDATE SAIDAS
        SET VENDEDOR = ?,
            OBS = ?,
            TOTAL = ?,
            TOTALITENS = ?,
            TOTALITENS123 = ?
        WHERE SAIDA = ?
      `,
      [
        vendedor,
        obs,
        total,
        total,
        total,
        id
      ]
    );

    await tx.query(`DELETE FROM SAIDASITENS WHERE SAIDA = ?`, [id]);

    for (let index = 0; index < itens.length; index += 1) {
      await inserirItemPedido(tx, pedidoAtual, itens[index], index + 1);
    }

    if (deveAtualizarCarrada) {
      await substituirCarradaDoPedido(tx, pedidoAtual, codigoCarrada);
    }

    return buscarDetalheEdicaoPedido(id, tx);
  });
}


function normalizarItensParticao(itens) {
  if (!Array.isArray(itens) || !itens.length) {
    throw new Error('Selecione ao menos um item para o novo pedido.');
  }

  const vistos = new Set();
  return itens.map((item, index) => {
    const saidaItem = normalizarInteiroPositivo(item?.saidaItem, `itens[${index}].saidaItem`);
    const quantidade = arredondarNumero(
      normalizarNumero(item?.quantidade, `itens[${index}].quantidade`)
    );

    if (quantidade <= 0) {
      throw new Error(`Item ${index + 1}: a quantidade transferida deve ser maior que zero.`);
    }

    if (vistos.has(saidaItem)) {
      throw new Error(`Item ${index + 1}: linha duplicada na divisão do pedido.`);
    }

    vistos.add(saidaItem);
    return { saidaItem, quantidade };
  });
}

function formatarNumeroPedido(valor) {
  return String(Number(valor)).padStart(7, '0');
}

function obterDataAtualFortaleza() {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Fortaleza',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date()).reduce((acc, parte) => {
    acc[parte.type] = parte.value;
    return acc;
  }, {});

  return `${partes.year}-${partes.month}-${partes.day}`;
}

async function gerarNumeroPedido(tx, tipoMovimento, empresa, pdv) {
  while (true) {
    const rows = await tx.query(
      'SELECT GEN_ID(GENSIST_TIPOMOVIMENTO_1, 1) AS NUMERO FROM RDB$DATABASE'
    );
    const numero = formatarNumeroPedido(rows?.[0]?.numero ?? rows?.[0]?.NUMERO ?? 0);
    const duplicados = await tx.query(
      `
        SELECT COUNT(*) AS TOTAL
        FROM SAIDAS
        WHERE TIPOMOVIMENTO = ?
          AND NUMERO = ?
          AND EMPRESA = ?
          AND PDV = ?
      `,
      [tipoMovimento, numero, empresa, pdv]
    );

    if (Number(duplicados?.[0]?.total ?? duplicados?.[0]?.TOTAL ?? 0) === 0) {
      return numero;
    }
  }
}

async function buscarDadosParticaoPedido(tx, idMestre) {
  const rows = await tx.query(
    `
      SELECT FIRST 1
        S.EMPRESA,
        S.SAIDA,
        S.PDV,
        S.NUMERO,
        S.DATA,
        S.FAVORECIDO,
        S.OBS,
        S.VENDEDOR,
        S.FRETE,
        S.TOTAL,
        S.SITUACAO,
        S.TIPOMOVIMENTO,
        S.DESCONTO,
        S.BAIXAESTOQUE,
        S.CALCCOMISSAO,
        S.TIPOPADRAO,
        S.STATUS,
        S.VOLUMES,
        S.POSSUIICMS,
        S.MODELO,
        S.FONTE,
        S.BAIXAESTOQUEFISCAL
      FROM SAIDAS S
      WHERE S.SAIDA = ?
    `,
    [idMestre]
  );

  return rows[0] || null;
}

async function inserirSaidaParticionada(tx, original, novoPedido) {
  await tx.query(
    `
      INSERT INTO SAIDAS (
        EMPRESA,
        SAIDA,
        PDV,
        NUMERO,
        DATA,
        FAVORECIDO,
        OBS,
        VENDEDOR,
        FRETE,
        TOTAL,
        SITUACAO,
        TIPOMOVIMENTO,
        DESCONTO,
        BAIXAESTOQUE,
        CALCCOMISSAO,
        TIPOPADRAO,
        TOTALITENS,
        STATUS,
        TOTALITENS123,
        VOLUMES,
        POSSUIICMS,
        MODELO,
        FONTE,
        BAIXAESTOQUEFISCAL
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
    `,
    [
      original.empresa,
      novoPedido.saida,
      original.pdv,
      novoPedido.numero,
      novoPedido.data,
      original.favorecido,
      original.obs || null,
      original.vendedor,
      0,
      novoPedido.total,
      'N',
      original.tipomovimento,
      0,
      original.baixaestoque || 'N',
      original.calccomissao || 'N',
      original.tipopadrao,
      novoPedido.total,
      'P',
      novoPedido.total,
      0,
      original.possuiicms || 'N',
      original.modelo || '55',
      original.fonte || 'M',
      original.baixaestoquefiscal || 'N'
    ]
  );
}

async function reordenarItensPedido(tx, saida) {
  const rows = await tx.query(
    `
      SELECT SAIDAITEM
      FROM SAIDASITENS
      WHERE SAIDA = ?
      ORDER BY SEQUENCIA, SAIDAITEM
    `,
    [saida]
  );

  for (let index = 0; index < rows.length; index += 1) {
    const saidaItem = rows[index].saidaitem ?? rows[index].SAIDAITEM;
    await tx.query(
      `UPDATE SAIDASITENS SET SEQUENCIA = ?, ORDEM = ? WHERE SAIDAITEM = ?`,
      [index + 1, index + 1, saidaItem]
    );
  }
}

async function calcularDadosGeorgeVenda(tx, pedido) {
  const lucroRows = await tx.query(
    `
      SELECT SUM(SI.QUANTIDADE * (SI.PRECO - I.CUSTOMANUAL)) AS LUCRO_TOTAL
      FROM SAIDASITENS SI
      JOIN ITENS I ON I.ITEM = SI.ITEM
      JOIN PRODUTOSPRECO PP ON PP.ITEM = I.ITEM
      WHERE SI.SAIDA = ?
        AND PP.TABELAPRECO = 0
    `,
    [pedido.saida]
  );
  const qtdeRows = await tx.query(
    `SELECT SUM(QUANTIDADE) AS QTDE FROM SAIDASITENS WHERE SAIDA = ?`,
    [pedido.saida]
  );

  return {
    lucro: Number(lucroRows?.[0]?.lucro_total ?? lucroRows?.[0]?.LUCRO_TOTAL ?? 0),
    quantidade: Number(qtdeRows?.[0]?.qtde ?? qtdeRows?.[0]?.QTDE ?? 0)
  };
}

async function gerarCodigo(tx, generator) {
  const rows = await tx.query(`SELECT GEN_ID(${generator}, 1) AS CODIGO FROM RDB$DATABASE`);
  const codigo = Number(rows?.[0]?.codigo ?? rows?.[0]?.CODIGO ?? 0);
  if (!codigo) {
    throw new Error('Não foi possível gerar o código financeiro da divisão.');
  }
  return codigo;
}

async function salvarGeorgeVenda(tx, pedido, codigoExistente = null) {
  const dados = await calcularDadosGeorgeVenda(tx, pedido);

  if (codigoExistente) {
    await tx.query(
      `
        UPDATE GEORGE_VENDAS
        SET NUMERO = ?, DATA = ?, FAVORECIDO = ?, TOTAL = ?, VENDEDOR = ?, LUCRO = ?, QTDE_ITENS = ?
        WHERE CODIGO = ?
      `,
      [
        pedido.numero,
        pedido.data,
        pedido.favorecido,
        pedido.total,
        pedido.vendedor,
        dados.lucro,
        dados.quantidade,
        codigoExistente
      ]
    );
    return Number(codigoExistente);
  }

  const codigo = await gerarCodigo(tx, 'GEN_GEO_VENDAS_ID');
  await tx.query(
    `
      INSERT INTO GEORGE_VENDAS (
        CODIGO, NUMERO, DATA, FAVORECIDO, TOTAL, VENDEDOR, LUCRO, QTDE_ITENS
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      codigo,
      pedido.numero,
      pedido.data,
      pedido.favorecido,
      pedido.total,
      pedido.vendedor,
      dados.lucro,
      dados.quantidade
    ]
  );

  return codigo;
}

async function buscarPagamentosPedidoParaParticao(tx, pedido) {
  const rows = await tx.query(
    `
      SELECT
        GVP.CODIGO,
        GVP.COD_VENDA,
        GVP.EMPRESA,
        GVP.SAIDA,
        GVP.PDV,
        GVP.CONDICAO,
        GVP.DATA_VENCIMENTO,
        GVP.PAGO,
        GVP.DATA_PGTO,
        GVP.VALOR,
        GVP.TITULAR_CHEQUE,
        GVP.OBSERVACAO,
        GVP.NUMERO_CHEQUE
      FROM GEORGE_VENDAS_PGTO GVP
      LEFT JOIN GEORGE_VENDAS GV ON GV.CODIGO = GVP.COD_VENDA
      WHERE (
          GVP.EMPRESA = ?
          AND GVP.SAIDA = ?
          AND GVP.PDV = ?
        )
        OR (
          (GVP.EMPRESA IS NULL OR GVP.SAIDA IS NULL OR GVP.PDV IS NULL)
          AND GV.NUMERO = ?
          AND GV.DATA = ?
          AND COALESCE(GV.FAVORECIDO, -9) = ?
          AND COALESCE(GV.VENDEDOR, -9) = ?
          AND ABS(COALESCE(GV.TOTAL, 0) - ?) < 0.0001
        )
      ORDER BY COALESCE(GVP.DATA_PGTO, GVP.DATA_VENCIMENTO), GVP.CODIGO
    `,
    [
      pedido.empresa,
      pedido.saida,
      pedido.pdv,
      pedido.numero,
      pedido.data,
      Number(pedido.favorecido ?? -9),
      Number(pedido.vendedor ?? -9),
      Number(pedido.total ?? 0)
    ]
  );

  return rows;
}

function formatarMoedaBR(valor) {
  return Number(valor || 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).replace(/\u00a0/g, ' ');
}

function montarObservacaoPagamentoParticionado(observacaoAtual, parte, totalPartes, valorPagamentoOriginal) {
  const limite = 300;
  const anotacao = `(pgto ${parte}-${totalPartes}, valor original ${formatarMoedaBR(valorPagamentoOriginal)})`;
  const observacao = textoOuVazio(observacaoAtual);

  if (!observacao) {
    return anotacao.slice(0, limite);
  }

  const separador = ' | ';
  const limiteObservacao = Math.max(limite - separador.length - anotacao.length, 0);
  const observacaoPreservada = observacao.slice(0, limiteObservacao).trim();
  return observacaoPreservada
    ? `${observacaoPreservada}${separador}${anotacao}`
    : anotacao.slice(0, limite);
}

async function inserirPagamentoClonado(
  tx,
  pagamento,
  destino,
  codigoGeorgeVenda,
  valor,
  observacao = pagamento.observacao
) {
  const codigo = await gerarCodigo(tx, 'GEN_GEO_VENDAS_PGTO_ID');
  await tx.query(
    `
      INSERT INTO GEORGE_VENDAS_PGTO (
        CODIGO, COD_VENDA, EMPRESA, SAIDA, PDV, CONDICAO, DATA_VENCIMENTO,
        PAGO, DATA_PGTO, VALOR, TITULAR_CHEQUE, OBSERVACAO, NUMERO_CHEQUE
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      codigo,
      codigoGeorgeVenda,
      destino.empresa,
      destino.saida,
      destino.pdv,
      pagamento.condicao,
      pagamento.data_vencimento,
      pagamento.pago,
      pagamento.data_pgto,
      valor,
      pagamento.titular_cheque,
      observacao,
      pagamento.numero_cheque
    ]
  );
  return codigo;
}

async function redistribuirPagamentosParticao(tx, originalAntes, originalDepois, novoPedido) {
  const pagamentos = await buscarPagamentosPedidoParaParticao(tx, originalAntes);
  if (!pagamentos.length) {
    return {
      totalAntes: 0,
      totalOriginal: 0,
      totalNovo: 0,
      movidos: [],
      divididos: []
    };
  }

  const codigoOriginalPreferido = Number(
    pagamentos.find((item) => Number(item.cod_venda || 0) > 0)?.cod_venda || 0
  ) || null;
  const codigoGeorgeOriginal = await salvarGeorgeVenda(tx, originalDepois, codigoOriginalPreferido);
  const codigoGeorgeNovo = await salvarGeorgeVenda(tx, novoPedido);
  let capacidadeOriginal = Math.max(Number(Number(originalDepois.total || 0).toFixed(2)), 0);
  let totalOriginal = 0;
  let totalNovo = 0;
  const movidos = [];
  const divididos = [];

  for (const pagamento of pagamentos) {
    const codigoPagamento = Number(pagamento.codigo || 0);
    const valor = Number(Number(pagamento.valor || 0).toFixed(2));

    if (valor <= 0) {
      continue;
    }

    if (capacidadeOriginal <= 0.004) {
      await tx.query(
        `
          UPDATE GEORGE_VENDAS_PGTO
          SET COD_VENDA = ?, EMPRESA = ?, SAIDA = ?, PDV = ?
          WHERE CODIGO = ?
        `,
        [codigoGeorgeNovo, novoPedido.empresa, novoPedido.saida, novoPedido.pdv, codigoPagamento]
      );
      totalNovo += valor;
      movidos.push({ codigo: codigoPagamento, valor, destino: 'novo' });
      continue;
    }

    if (valor <= capacidadeOriginal + 0.004) {
      await tx.query(
        `
          UPDATE GEORGE_VENDAS_PGTO
          SET COD_VENDA = ?, EMPRESA = ?, SAIDA = ?, PDV = ?
          WHERE CODIGO = ?
        `,
        [codigoGeorgeOriginal, originalDepois.empresa, originalDepois.saida, originalDepois.pdv, codigoPagamento]
      );
      capacidadeOriginal = Number((capacidadeOriginal - valor).toFixed(2));
      totalOriginal += valor;
      continue;
    }

    const valorOriginal = Number(capacidadeOriginal.toFixed(2));
    const valorNovo = Number((valor - valorOriginal).toFixed(2));
    const observacaoOriginal = montarObservacaoPagamentoParticionado(
      pagamento.observacao,
      1,
      2,
      valor
    );
    const observacaoNovo = montarObservacaoPagamentoParticionado(
      pagamento.observacao,
      2,
      2,
      valor
    );

    await tx.query(
      `
        UPDATE GEORGE_VENDAS_PGTO
        SET COD_VENDA = ?, EMPRESA = ?, SAIDA = ?, PDV = ?, VALOR = ?, OBSERVACAO = ?
        WHERE CODIGO = ?
      `,
      [
        codigoGeorgeOriginal,
        originalDepois.empresa,
        originalDepois.saida,
        originalDepois.pdv,
        valorOriginal,
        observacaoOriginal,
        codigoPagamento
      ]
    );

    const novoCodigoPagamento = await inserirPagamentoClonado(
      tx,
      pagamento,
      novoPedido,
      codigoGeorgeNovo,
      valorNovo,
      observacaoNovo
    );

    totalOriginal += valorOriginal;
    totalNovo += valorNovo;
    capacidadeOriginal = 0;
    divididos.push({
      codigoOriginal: codigoPagamento,
      codigoNovo: novoCodigoPagamento,
      valorOriginal,
      valorNovo,
      observacaoOriginal,
      observacaoNovo
    });
  }

  return {
    totalAntes: Number((totalOriginal + totalNovo).toFixed(2)),
    totalOriginal: Number(totalOriginal.toFixed(2)),
    totalNovo: Number(totalNovo.toFixed(2)),
    movidos,
    divididos
  };
}

async function copiarPedido(idMestre, payload = {}) {
  const id = normalizarInteiroPositivo(idMestre, 'idMestre');
  const codigoCarrada = normalizarInteiroPositivo(payload?.codigoCarrada, 'codigoCarrada');

  return firebirdService.withTransaction(async (tx) => {
    const original = await buscarDadosParticaoPedido(tx, id);

    if (!original) {
      throw new Error('Pedido não encontrado.');
    }

    if (textoOuVazio(original.situacao).toUpperCase() === 'C') {
      throw new Error('Pedido cancelado não pode ser copiado.');
    }

    const carradaDestino = await buscarCarradaPorCodigo(codigoCarrada, tx);

    if (!carradaDestino) {
      throw new Error('Carrada selecionada não encontrada.');
    }

    const carradaAtual = await buscarCarradaAtualDoPedido(original.numero, tx);

    if (Number(carradaAtual?.codigo || 0) === Number(codigoCarrada)) {
      throw new Error('Selecione uma carrada diferente da carrada atual.');
    }

    const itensOriginais = await buscarItensPedido(id, tx);

    if (!itensOriginais.length) {
      throw new Error('O pedido não possui itens para copiar.');
    }

    const itensCopiados = itensOriginais.map((item) => ({
      item: Number(item.item),
      descricao: item.descricao || null,
      quantidade: arredondarNumero(item.quantidade),
      preco: arredondarNumero(item.preco, 3),
      subtotalitem: arredondarNumero(Number(item.quantidade || 0) * Number(item.preco || 0))
    }));
    const totalNovo = arredondarNumero(
      itensCopiados.reduce((acc, item) => acc + Number(item.subtotalitem || 0), 0)
    );
    const novaSaida = await gerarIdGlobal(tx);
    const novoNumero = await gerarNumeroPedido(
      tx,
      original.tipomovimento,
      original.empresa,
      original.pdv
    );
    const novoPedido = {
      empresa: original.empresa,
      saida: novaSaida,
      pdv: original.pdv,
      numero: novoNumero,
      data: obterDataAtualFortaleza(),
      favorecido: original.favorecido,
      vendedor: original.vendedor,
      total: totalNovo,
      volumes: 0
    };

    await inserirSaidaParticionada(tx, original, novoPedido);

    for (let index = 0; index < itensCopiados.length; index += 1) {
      await inserirItemPedido(tx, novoPedido, itensCopiados[index], index + 1);
    }

    await substituirCarradaDoPedido(tx, novoPedido, codigoCarrada);

    const pedidoNovoCriado = await buscarDetalheEdicaoPedido(novaSaida, tx);

    return {
      pedidoNovo: pedidoNovoCriado,
      pedidoOrigem: {
        idMestre: original.saida,
        saida: original.saida,
        numero: original.numero
      },
      carradaDestino
    };
  });
}

async function particionarPedido(idMestre, payload = {}) {
  const id = normalizarInteiroPositivo(idMestre, 'idMestre');
  const codigoCarrada = normalizarInteiroPositivo(payload?.codigoCarrada, 'codigoCarrada');
  const itensSelecionados = normalizarItensParticao(payload?.itens);

  return firebirdService.withTransaction(async (tx) => {
    const original = await buscarDadosParticaoPedido(tx, id);
    if (!original) {
      throw new Error('Pedido não encontrado.');
    }

    const valorPedidoOriginal = arredondarNumero(original.total);

    if (textoOuVazio(original.situacao).toUpperCase() === 'C') {
      throw new Error('Pedido cancelado não pode ser particionado.');
    }

    const carradaDestino = await buscarCarradaPorCodigo(codigoCarrada, tx);
    if (!carradaDestino) {
      throw new Error('Carrada selecionada não encontrada.');
    }

    const carradaAtual = await buscarCarradaAtualDoPedido(original.numero, tx);
    if (Number(carradaAtual?.codigo || 0) === Number(codigoCarrada)) {
      throw new Error('Selecione uma carrada diferente da carrada atual.');
    }

    const itensOriginais = await buscarItensPedido(id, tx);
    const porSaidaItem = new Map(
      itensOriginais.map((item) => [Number(item.saidaItem), item])
    );
    const novosItens = [];
    let totalNovo = 0;

    for (const selecionado of itensSelecionados) {
      const itemOriginal = porSaidaItem.get(Number(selecionado.saidaItem));
      if (!itemOriginal) {
        throw new Error(`Linha ${selecionado.saidaItem} não pertence ao pedido informado.`);
      }

      if (selecionado.quantidade > Number(itemOriginal.quantidade) + 0.000001) {
        throw new Error(`Quantidade maior que a disponível para o item ${itemOriginal.descricao}.`);
      }

      const subtotal = arredondarNumero(selecionado.quantidade * Number(itemOriginal.preco || 0));
      novosItens.push({
        item: Number(itemOriginal.item),
        descricao: itemOriginal.descricao || null,
        quantidade: selecionado.quantidade,
        preco: Number(itemOriginal.preco || 0),
        subtotalitem: subtotal
      });
      totalNovo += subtotal;
    }

    if (!novosItens.length) {
      throw new Error('Selecione ao menos um item para o novo pedido.');
    }

    for (const selecionado of itensSelecionados) {
      const itemOriginal = porSaidaItem.get(Number(selecionado.saidaItem));
      const restante = arredondarNumero(Number(itemOriginal.quantidade) - selecionado.quantidade);

      if (restante <= 0.000001) {
        await tx.query(`DELETE FROM SAIDASITENS WHERE SAIDAITEM = ? AND SAIDA = ?`, [selecionado.saidaItem, id]);
      } else {
        await tx.query(
          `UPDATE SAIDASITENS SET QUANTIDADE = ?, SUBTOTALITEM = ? WHERE SAIDAITEM = ? AND SAIDA = ?`,
          [
            restante,
            arredondarNumero(restante * Number(itemOriginal.preco || 0)),
            selecionado.saidaItem,
            id
          ]
        );
      }
    }

    const restantesRows = await tx.query(
      `SELECT COUNT(*) AS TOTAL FROM SAIDASITENS WHERE SAIDA = ?`,
      [id]
    );
    if (Number(restantesRows?.[0]?.total ?? restantesRows?.[0]?.TOTAL ?? 0) <= 0) {
      throw new Error('A divisão não pode deixar o pedido original sem itens.');
    }

    await reordenarItensPedido(tx, id);
    const totalOriginalRows = await tx.query(
      `SELECT SUM(SUBTOTALITEM) AS TOTAL FROM SAIDASITENS WHERE SAIDA = ?`,
      [id]
    );
    const totalOriginal = arredondarNumero(
      totalOriginalRows?.[0]?.total ?? totalOriginalRows?.[0]?.TOTAL ?? 0
    );
    totalNovo = arredondarNumero(totalNovo);

    await tx.query(
      `
        UPDATE SAIDAS
        SET TOTAL = ?, TOTALITENS = ?, TOTALITENS123 = ?
        WHERE SAIDA = ?
      `,
      [totalOriginal, totalOriginal, totalOriginal, id]
    );

    const novaSaida = await gerarIdGlobal(tx);
    const novoNumero = await gerarNumeroPedido(
      tx,
      original.tipomovimento,
      original.empresa,
      original.pdv
    );
    const novoPedido = {
      empresa: original.empresa,
      saida: novaSaida,
      pdv: original.pdv,
      numero: novoNumero,
      data: obterDataAtualFortaleza(),
      favorecido: original.favorecido,
      vendedor: original.vendedor,
      total: totalNovo,
      volumes: 0
    };

    await inserirSaidaParticionada(tx, original, novoPedido);
    for (let index = 0; index < novosItens.length; index += 1) {
      await inserirItemPedido(tx, novoPedido, novosItens[index], index + 1);
    }
    await substituirCarradaDoPedido(tx, novoPedido, codigoCarrada);

    const originalDepois = {
      empresa: original.empresa,
      saida: original.saida,
      pdv: original.pdv,
      numero: original.numero,
      data: original.data,
      favorecido: original.favorecido,
      vendedor: original.vendedor,
      total: totalOriginal
    };
    const pagamentos = await redistribuirPagamentosParticao(
      tx,
      { ...originalDepois, total: valorPedidoOriginal },
      originalDepois,
      novoPedido
    );

    const pedidoOriginalAtualizado = await buscarDetalheEdicaoPedido(id, tx);
    const pedidoNovoCriado = await buscarDetalheEdicaoPedido(novaSaida, tx);

    return {
      pedidoOriginal: pedidoOriginalAtualizado,
      pedidoNovo: pedidoNovoCriado,
      carradaDestino,
      pagamentos
    };
  });
}

module.exports = {
  pesquisarPedidos,
  buscarPedidoPorId,
  buscarItensPedido,
  buscarDetalheEdicaoPedido,
  listarCarradasDisponiveisParaPedido,
  alterarCarradaPedido,
  atualizarVolumesPedido,
  atualizarPedido,
  copiarPedido,
  particionarPedido
};
