const pool = require('../../../../db/connection');
const carradasService = require('../carradas/carradas.service');

function criarErro(message, status = 400) {
  const error = new Error(message);
  error.statusCode = status;
  return error;
}

async function tabelasSemanaExistem(client = pool) {
  const result = await client.query(
    `SELECT to_regclass('public.semanas') AS semanas, to_regclass('public.semana_carradas') AS semana_carradas`
  );

  return Boolean(result.rows[0]?.semanas) && Boolean(result.rows[0]?.semana_carradas);
}

async function garantirTabelasSemana(client = pool) {
  const existem = await tabelasSemanaExistem(client);

  if (!existem) {
    throw criarErro('As tabelas do módulo de semanas ainda não foram criadas no PostgreSQL. Execute o arquivo render/db/sql/20260402_semanas.sql antes de usar este módulo.', 500);
  }
}

function parseId(value, fieldName = 'ID') {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw criarErro(`${fieldName} inválido.`, 400);
  }

  return parsed;
}

function normalizarDataIso(value) {
  if (!value) return null;
  const text = String(value).trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return text;
  }

  const date = new Date(text);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString().slice(0, 10);
}

function normalizarTexto(value) {
  const text = String(value || '').trim();
  return text ? text : null;
}

function normalizarListaCarradas(carradas) {
  if (!Array.isArray(carradas)) {
    return [];
  }

  const codigos = carradas
    .map((item) => {
      if (item && typeof item === 'object') {
        return Number.parseInt(item.codigo ?? item.codigo_carrada, 10);
      }

      return Number.parseInt(item, 10);
    })
    .filter((codigo) => Number.isInteger(codigo) && codigo > 0);

  return Array.from(new Set(codigos));
}

function validarPayloadSemana(payload) {
  const dataInicial = normalizarDataIso(payload?.data_inicial);
  const dataFinal = normalizarDataIso(payload?.data_final);
  const descricao = normalizarTexto(payload?.descricao);
  const carradas = normalizarListaCarradas(payload?.carradas);

  if (!dataInicial) {
    throw criarErro('Informe a data inicial da semana.', 400);
  }

  if (!dataFinal) {
    throw criarErro('Informe a data final da semana.', 400);
  }

  if (dataFinal < dataInicial) {
    throw criarErro('A data final não pode ser menor que a data inicial.', 400);
  }

  if (!carradas.length) {
    throw criarErro('Selecione ao menos uma carrada.', 400);
  }

  return {
    dataInicial,
    dataFinal,
    descricao,
    carradas
  };
}

function resumirCarradaDetalhada(carrada) {
  const pedidos = Array.isArray(carrada?.pedidos) ? carrada.pedidos : [];

  const resumo = pedidos.reduce((acc, pedido) => {
    acc.quantidadePedidos += 1;
    acc.totalPedidos += Number(pedido?.total || 0);

    const itens = Array.isArray(pedido?.itens) ? pedido.itens : [];
    itens.forEach((item) => {
      acc.quantidadeItens += Number(item?.quantidade || 0);
    });

    return acc;
  }, {
    quantidadePedidos: 0,
    quantidadeItens: 0,
    totalPedidos: 0
  });

  return {
    codigo: carrada?.codigo,
    data: carrada?.data || null,
    descricao: carrada?.descricao || '',
    quantidade_pedidos: resumo.quantidadePedidos,
    quantidade_itens: resumo.quantidadeItens,
    total_pedidos: resumo.totalPedidos
  };
}

async function carregarDetalhesCarradas(codigosCarradas) {
  if (!codigosCarradas.length) {
    return [];
  }

  const carradas = await Promise.all(
    codigosCarradas.map((codigoCarrada) => carradasService.buscarCarrada(codigoCarrada))
  );

  return carradas.filter(Boolean);
}

function consolidarResumoSemana(semana, carradasDetalhadas) {
  const mapa = new Map();
  let totalPedidos = 0;
  let totalItens = 0;
  let totalGeral = 0;

  carradasDetalhadas.forEach((carrada) => {
    const codigoCarrada = carrada?.codigo ? String(carrada.codigo) : '';
    const pedidos = Array.isArray(carrada?.pedidos) ? carrada.pedidos : [];

    totalPedidos += pedidos.length;

    pedidos.forEach((pedido) => {
      const numeroPedido = pedido?.numero ? String(pedido.numero) : '';
      totalGeral += Number(pedido?.total || 0);

      const itens = Array.isArray(pedido?.itens) ? pedido.itens : [];
      itens.forEach((item) => {
        const codigoItem = Number(item?.item || 0);
        const descricao = String(item?.descricaoOriginal || item?.descricao || '').trim();
        const chave = codigoItem > 0
          ? String(codigoItem)
          : `SEM-CODIGO::${descricao.toUpperCase()}`;
        const quantidade = Number(item?.quantidade || 0);

        totalItens += quantidade;

        if (!mapa.has(chave)) {
          mapa.set(chave, {
            item: codigoItem > 0 ? codigoItem : null,
            descricao,
            quantidade: 0,
            pedidos: new Set(),
            carradas: new Set()
          });
        }

        const atual = mapa.get(chave);
        if (!atual.descricao && descricao) {
          atual.descricao = descricao;
        }
        atual.quantidade += quantidade;
        if (numeroPedido) {
          atual.pedidos.add(numeroPedido);
        }
        if (codigoCarrada) {
          atual.carradas.add(codigoCarrada);
        }
      });
    });
  });

  const itens = Array.from(mapa.values())
    .map((item) => ({
      item: item.item,
      descricao: item.descricao,
      quantidade: item.quantidade,
      totalPedidos: item.pedidos.size,
      totalCarradas: item.carradas.size,
      numerosPedidos: Array.from(item.pedidos).sort((a, b) => String(a).localeCompare(String(b), 'pt-BR', { numeric: true })),
      codigosCarradas: Array.from(item.carradas).sort((a, b) => String(a).localeCompare(String(b), 'pt-BR', { numeric: true }))
    }))
    .sort((a, b) => String(a.descricao || '').localeCompare(String(b.descricao || ''), 'pt-BR'));

  const carradas = carradasDetalhadas
    .map((carrada) => resumirCarradaDetalhada(carrada))
    .sort((a, b) => Number(a.codigo || 0) - Number(b.codigo || 0));

  return {
    semana: {
      id: semana.id,
      data_inicial: semana.data_inicial,
      data_final: semana.data_final,
      descricao: semana.descricao || ''
    },
    carradas,
    itens,
    totais: {
      quantidade_carradas: carradas.length,
      quantidade_pedidos: totalPedidos,
      quantidade_itens: totalItens,
      total_geral_pedidos: totalGeral,
      quantidade_tipos_itens: itens.length
    }
  };
}

async function validarCarradasExistentes(codigosCarradas) {
  const carradas = await carradasService.listarCarradas();
  const codigosExistentes = new Set(
    carradas
      .map((carrada) => Number.parseInt(carrada?.codigo, 10))
      .filter((codigo) => Number.isInteger(codigo) && codigo > 0)
  );

  const codigosInvalidos = codigosCarradas.filter((codigo) => !codigosExistentes.has(codigo));

  if (codigosInvalidos.length) {
    throw criarErro(`Carrada(s) não encontrada(s): ${codigosInvalidos.join(', ')}.`, 400);
  }
}

async function validarConflitoCarradas(codigosCarradas, semanaIdAtual = null, client = pool) {
  if (!codigosCarradas.length) {
    return;
  }

  const values = [codigosCarradas];
  let query = `
    SELECT sc.codigo_carrada, s.id, s.descricao, s.data_inicial, s.data_final
    FROM semana_carradas sc
    INNER JOIN semanas s ON s.id = sc.semana_id
    WHERE sc.codigo_carrada = ANY($1::int[])
  `;

  if (semanaIdAtual) {
    values.push(semanaIdAtual);
    query += ' AND sc.semana_id <> $2';
  }

  const result = await client.query(query, values);

  if (result.rows.length) {
    const conflito = result.rows[0];
    throw criarErro(
      `A carrada ${conflito.codigo_carrada} já pertence à semana de ${conflito.data_inicial} até ${conflito.data_final}${conflito.descricao ? ` (${conflito.descricao})` : ''}.`,
      409
    );
  }
}

async function listarSemanas(filtros = {}) {
  await garantirTabelasSemana();

  const where = [];
  const values = [];

  const descricao = normalizarTexto(filtros.descricao);
  const dataInicial = normalizarDataIso(filtros.data_inicial);
  const dataFinal = normalizarDataIso(filtros.data_final);

  if (descricao) {
    values.push(`%${descricao}%`);
    where.push(`COALESCE(s.descricao, '') ILIKE $${values.length}`);
  }

  if (dataInicial) {
    values.push(dataInicial);
    where.push(`s.data_inicial >= $${values.length}`);
  }

  if (dataFinal) {
    values.push(dataFinal);
    where.push(`s.data_final <= $${values.length}`);
  }

  const query = `
    SELECT
      s.id,
      s.data_inicial,
      s.data_final,
      s.descricao,
      COUNT(sc.id)::int AS quantidade_carradas
    FROM semanas s
    LEFT JOIN semana_carradas sc ON sc.semana_id = s.id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    GROUP BY s.id, s.data_inicial, s.data_final, s.descricao
    ORDER BY s.data_inicial DESC, s.id DESC
  `;

  const result = await pool.query(query, values);
  return result.rows;
}

async function listarCarradasDisponiveis(filtros = {}) {
  await garantirTabelasSemana();

  const semanaIdExcluir = filtros.semana_id_excluir ? parseId(filtros.semana_id_excluir, 'Semana') : null;
  const dataExata = normalizarDataIso(filtros.data);
  const dataInicial = normalizarDataIso(filtros.data_inicial);
  const dataFinal = normalizarDataIso(filtros.data_final);
  const descricao = String(filtros.descricao || '').trim().toLowerCase();

  if (dataInicial && dataFinal && dataFinal < dataInicial) {
    throw criarErro('O período informado é inválido.', 400);
  }

  const carradas = await carradasService.listarCarradas();

  const query = semanaIdExcluir
    ? 'SELECT codigo_carrada FROM semana_carradas WHERE semana_id <> $1'
    : 'SELECT codigo_carrada FROM semana_carradas';
  const params = semanaIdExcluir ? [semanaIdExcluir] : [];
  const vinculos = await pool.query(query, params);
  const usadas = new Set(
    vinculos.rows
      .map((row) => Number.parseInt(row.codigo_carrada, 10))
      .filter((codigo) => Number.isInteger(codigo))
  );

  return carradas
    .filter((carrada) => !usadas.has(Number.parseInt(carrada?.codigo, 10)))
    .filter((carrada) => {
      const descricaoCarrada = String(carrada?.descricao || '').toLowerCase();
      const dataCarrada = normalizarDataIso(carrada?.data);

      if (descricao && !descricaoCarrada.includes(descricao)) {
        return false;
      }

      if (dataExata && dataCarrada !== dataExata) {
        return false;
      }

      if (dataInicial && (!dataCarrada || dataCarrada < dataInicial)) {
        return false;
      }

      if (dataFinal && (!dataCarrada || dataCarrada > dataFinal)) {
        return false;
      }

      return true;
    })
    .sort((a, b) => {
      const dataA = normalizarDataIso(a?.data) || '';
      const dataB = normalizarDataIso(b?.data) || '';
      if (dataA !== dataB) {
        return dataB.localeCompare(dataA);
      }
      return Number(b?.codigo || 0) - Number(a?.codigo || 0);
    });
}

async function buscarSemanaPorId(id) {
  await garantirTabelasSemana();
  const semanaId = parseId(id, 'Semana');

  const semanaResult = await pool.query(
    'SELECT id, data_inicial, data_final, descricao FROM semanas WHERE id = $1',
    [semanaId]
  );

  const semana = semanaResult.rows[0];
  if (!semana) {
    return null;
  }

  const vinculosResult = await pool.query(
    `
      SELECT codigo_carrada
      FROM semana_carradas
      WHERE semana_id = $1
      ORDER BY ordem ASC, id ASC
    `,
    [semanaId]
  );

  const codigosCarradas = vinculosResult.rows
    .map((row) => Number.parseInt(row.codigo_carrada, 10))
    .filter((codigo) => Number.isInteger(codigo));

  const carradasDetalhadas = await carregarDetalhesCarradas(codigosCarradas);
  const carradas = carradasDetalhadas.map((carrada) => resumirCarradaDetalhada(carrada));

  const totais = carradas.reduce((acc, carrada) => {
    acc.quantidade_carradas += 1;
    acc.quantidade_pedidos += Number(carrada.quantidade_pedidos || 0);
    acc.quantidade_itens += Number(carrada.quantidade_itens || 0);
    acc.total_geral_pedidos += Number(carrada.total_pedidos || 0);
    return acc;
  }, {
    quantidade_carradas: 0,
    quantidade_pedidos: 0,
    quantidade_itens: 0,
    total_geral_pedidos: 0
  });

  return {
    ...semana,
    carradas,
    totais
  };
}

async function buscarResumoSemana(id) {
  await garantirTabelasSemana();
  const semanaId = parseId(id, 'Semana');
  const semana = await buscarSemanaPorId(semanaId);

  if (!semana) {
    return null;
  }

  const codigosCarradas = semana.carradas
    .map((carrada) => Number.parseInt(carrada.codigo, 10))
    .filter((codigo) => Number.isInteger(codigo));

  const carradasDetalhadas = await carregarDetalhesCarradas(codigosCarradas);

  return consolidarResumoSemana(semana, carradasDetalhadas);
}

async function criarSemana(payload) {
  await garantirTabelasSemana();
  const dados = validarPayloadSemana(payload);
  await validarCarradasExistentes(dados.carradas);

  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await validarConflitoCarradas(dados.carradas, null, client);

    const insertSemana = await client.query(
      `
        INSERT INTO semanas (data_inicial, data_final, descricao, created_at, updated_at)
        VALUES ($1, $2, $3, NOW(), NOW())
        RETURNING id, data_inicial, data_final, descricao
      `,
      [dados.dataInicial, dados.dataFinal, dados.descricao]
    );

    const semana = insertSemana.rows[0];

    for (let index = 0; index < dados.carradas.length; index += 1) {
      await client.query(
        `
          INSERT INTO semana_carradas (semana_id, codigo_carrada, ordem, created_at)
          VALUES ($1, $2, $3, NOW())
        `,
        [semana.id, dados.carradas[index], index]
      );
    }

    await client.query('COMMIT');
    return buscarSemanaPorId(semana.id);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function atualizarSemana(id, payload) {
  await garantirTabelasSemana();
  const semanaId = parseId(id, 'Semana');
  const dados = validarPayloadSemana(payload);
  await validarCarradasExistentes(dados.carradas);

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const existe = await client.query('SELECT id FROM semanas WHERE id = $1 FOR UPDATE', [semanaId]);
    if (!existe.rows.length) {
      throw criarErro('Semana não encontrada.', 404);
    }

    await validarConflitoCarradas(dados.carradas, semanaId, client);

    await client.query(
      `
        UPDATE semanas
        SET data_inicial = $1,
            data_final = $2,
            descricao = $3,
            updated_at = NOW()
        WHERE id = $4
      `,
      [dados.dataInicial, dados.dataFinal, dados.descricao, semanaId]
    );

    await client.query('DELETE FROM semana_carradas WHERE semana_id = $1', [semanaId]);

    for (let index = 0; index < dados.carradas.length; index += 1) {
      await client.query(
        `
          INSERT INTO semana_carradas (semana_id, codigo_carrada, ordem, created_at)
          VALUES ($1, $2, $3, NOW())
        `,
        [semanaId, dados.carradas[index], index]
      );
    }

    await client.query('COMMIT');
    return buscarSemanaPorId(semanaId);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function excluirSemana(id) {
  await garantirTabelasSemana();
  const semanaId = parseId(id, 'Semana');

  const result = await pool.query(
    'DELETE FROM semanas WHERE id = $1 RETURNING id, data_inicial, data_final, descricao',
    [semanaId]
  );

  return result.rows[0] || null;
}

async function buscarSemanaDaCarrada(codigoCarrada) {
  const codigo = parseId(codigoCarrada, 'Carrada');

  const existem = await tabelasSemanaExistem();
  if (!existem) {
    return null;
  }

  const result = await pool.query(
    `
      SELECT s.id, s.data_inicial, s.data_final, s.descricao, sc.codigo_carrada
      FROM semana_carradas sc
      INNER JOIN semanas s ON s.id = sc.semana_id
      WHERE sc.codigo_carrada = $1
      LIMIT 1
    `,
    [codigo]
  );

  return result.rows[0] || null;
}

module.exports = {
  listarSemanas,
  listarCarradasDisponiveis,
  buscarSemanaPorId,
  buscarResumoSemana,
  criarSemana,
  atualizarSemana,
  excluirSemana,
  buscarSemanaDaCarrada
};
