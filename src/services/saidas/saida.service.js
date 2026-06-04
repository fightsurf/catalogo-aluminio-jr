const pool = require('../../../db/connection');

const STATUS_VALIDOS = ['PAGO', 'PENDENTE', 'CANCELADO'];

function normalizarTexto(value) {
  return String(value || '').trim();
}

function normalizarId(value, campo = 'ID') {
  const numero = Number.parseInt(value, 10);
  if (!Number.isInteger(numero) || numero <= 0) {
    throw new Error(`${campo} inválido`);
  }
  return numero;
}

function normalizarMes(value) {
  const mes = Number.parseInt(value, 10);
  if (!Number.isInteger(mes) || mes < 1 || mes > 12) {
    throw new Error('Mês de competência inválido');
  }
  return mes;
}

function normalizarAno(value) {
  const ano = Number.parseInt(value, 10);
  if (!Number.isInteger(ano) || ano < 2000 || ano > 2100) {
    throw new Error('Ano de competência inválido');
  }
  return ano;
}

function normalizarValor(value) {
  if (value === undefined || value === null || value === '') return 0;
  const numero = Number(String(value).replace(',', '.'));
  if (!Number.isFinite(numero) || numero < 0) {
    throw new Error('Valor inválido');
  }
  return Number(numero.toFixed(2));
}

function normalizarStatus(value) {
  const status = normalizarTexto(value || 'PAGO').toUpperCase();
  if (!STATUS_VALIDOS.includes(status)) {
    throw new Error(`Status inválido. Use: ${STATUS_VALIDOS.join(', ')}`);
  }
  return status;
}

function normalizarData(value, campo = 'Data') {
  const texto = normalizarTexto(value);
  if (!texto) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texto)) {
    throw new Error(`${campo} inválida. Use AAAA-MM-DD`);
  }

  const [ano, mes, dia] = texto.split('-').map(Number);
  const data = new Date(Date.UTC(ano, mes - 1, dia));
  const dataValida = data.getUTCFullYear() === ano
    && data.getUTCMonth() === mes - 1
    && data.getUTCDate() === dia;

  if (!dataValida) {
    throw new Error(`${campo} inválida`);
  }

  return texto;
}

function dataBancoParaISO(value, campo = 'Data') {
  if (value === undefined || value === null || value === '') return null;

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new Error(`${campo} inválida`);
    }

    return formatarDataISO(
      value.getFullYear(),
      value.getMonth() + 1,
      value.getDate()
    );
  }

  const texto = normalizarTexto(value);
  if (!texto) return null;

  const matchISO = texto.match(/^(\d{4}-\d{2}-\d{2})/);
  if (matchISO) {
    return normalizarData(matchISO[1], campo);
  }

  const data = new Date(texto);
  if (!Number.isNaN(data.getTime())) {
    return formatarDataISO(
      data.getFullYear(),
      data.getMonth() + 1,
      data.getDate()
    );
  }

  return normalizarData(texto, campo);
}

function normalizarDataObrigatoria(value, campo = 'Data') {
  const data = normalizarData(value, campo);
  if (!data) {
    throw new Error(`${campo} é obrigatória`);
  }
  return data;
}

function parseDataISO(value, campo = 'Data') {
  const data = normalizarDataObrigatoria(value, campo);
  const [ano, mes, dia] = data.split('-').map(Number);
  return { data, ano, mes, dia };
}

function ultimoDiaMes(ano, mes) {
  return new Date(Date.UTC(ano, mes, 0)).getUTCDate();
}

function formatarDataISO(ano, mes, dia) {
  return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

function compararDataISO(a, b) {
  return String(a).localeCompare(String(b));
}

function gerarVencimentosMensais(primeiroVencimento, dataLimite) {
  const primeiro = parseDataISO(primeiroVencimento, 'Primeiro vencimento');
  const limite = parseDataISO(dataLimite, 'Data limite');

  if (compararDataISO(primeiro.data, limite.data) > 0) {
    throw new Error('O primeiro vencimento não pode ser maior que a data limite');
  }

  const vencimentos = [];
  const diaBase = primeiro.dia;
  let indice = 0;

  while (indice < 240) {
    const totalMeses = (primeiro.ano * 12) + (primeiro.mes - 1) + indice;
    const ano = Math.floor(totalMeses / 12);
    const mes = (totalMeses % 12) + 1;
    const dia = Math.min(diaBase, ultimoDiaMes(ano, mes));
    const data = formatarDataISO(ano, mes, dia);

    if (compararDataISO(data, limite.data) > 0) break;

    vencimentos.push({ data, ano, mes });
    indice += 1;
  }

  if (!vencimentos.length) {
    throw new Error('Nenhuma parcela foi gerada para o período informado');
  }

  return vencimentos;
}

function gerarLoteCarne() {
  return `CARNE-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

function mesAnterior(mes, ano) {
  if (mes === 1) return { mes: 12, ano: ano - 1 };
  return { mes: mes - 1, ano };
}

async function itemExiste(id) {
  const result = await pool.query('SELECT id FROM despesa_itens WHERE id = $1', [normalizarId(id, 'Item de saída')]);
  return result.rows.length > 0;
}

async function recalcularMediaAnual(itemSaidaId, ano, executor = pool) {
  const itemId = normalizarId(itemSaidaId, 'Item de saída');
  const anoReferencia = normalizarAno(ano);

  await executor.query(
    `INSERT INTO despesa_item_medias_anuais
       (item_saida_id, ano, valor_total, qtd_meses_considerados, valor_medio, atualizado_em)
     SELECT
       i.id AS item_saida_id,
       $2::int AS ano,
       COALESCE(SUM(CASE WHEN l.status IN ('PAGO', 'PENDENTE') THEN l.valor ELSE 0 END), 0)::numeric(14,2) AS valor_total,
       COUNT(DISTINCT CASE WHEN l.status IN ('PAGO', 'PENDENTE') THEN l.competencia_mes END)::int AS qtd_meses_considerados,
       CASE
         WHEN COUNT(DISTINCT CASE WHEN l.status IN ('PAGO', 'PENDENTE') THEN l.competencia_mes END) = 0 THEN 0
         ELSE ROUND(
           (COALESCE(SUM(CASE WHEN l.status IN ('PAGO', 'PENDENTE') THEN l.valor ELSE 0 END), 0)
            / COUNT(DISTINCT CASE WHEN l.status IN ('PAGO', 'PENDENTE') THEN l.competencia_mes END))::numeric,
           2
         )
       END::numeric(14,2) AS valor_medio,
       NOW() AS atualizado_em
     FROM despesa_itens i
     LEFT JOIN despesa_lancamentos l
       ON l.item_saida_id = i.id
      AND l.competencia_ano = $2
     WHERE i.id = $1
     GROUP BY i.id
     ON CONFLICT (item_saida_id, ano) DO UPDATE SET
       valor_total = EXCLUDED.valor_total,
       qtd_meses_considerados = EXCLUDED.qtd_meses_considerados,
       valor_medio = EXCLUDED.valor_medio,
       atualizado_em = NOW()`,
    [itemId, anoReferencia]
  );
}

async function recalcularMediasAnuais(pares = [], executor = pool) {
  const mapa = new Map();

  pares.forEach(par => {
    if (!par) return;
    const itemId = normalizarId(par.item_saida_id || par.itemSaidaId, 'Item de saída');
    const ano = normalizarAno(par.ano || par.competencia_ano);
    mapa.set(`${itemId}-${ano}`, { itemId, ano });
  });

  for (const par of mapa.values()) {
    await recalcularMediaAnual(par.itemId, par.ano, executor);
  }
}

async function recalcularTodasMediasAno(ano, executor = pool) {
  const anoReferencia = normalizarAno(ano);

  await executor.query(
    `INSERT INTO despesa_item_medias_anuais
       (item_saida_id, ano, valor_total, qtd_meses_considerados, valor_medio, atualizado_em)
     SELECT
       i.id AS item_saida_id,
       $1::int AS ano,
       COALESCE(SUM(CASE WHEN l.status IN ('PAGO', 'PENDENTE') THEN l.valor ELSE 0 END), 0)::numeric(14,2) AS valor_total,
       COUNT(DISTINCT CASE WHEN l.status IN ('PAGO', 'PENDENTE') THEN l.competencia_mes END)::int AS qtd_meses_considerados,
       CASE
         WHEN COUNT(DISTINCT CASE WHEN l.status IN ('PAGO', 'PENDENTE') THEN l.competencia_mes END) = 0 THEN 0
         ELSE ROUND(
           (COALESCE(SUM(CASE WHEN l.status IN ('PAGO', 'PENDENTE') THEN l.valor ELSE 0 END), 0)
            / COUNT(DISTINCT CASE WHEN l.status IN ('PAGO', 'PENDENTE') THEN l.competencia_mes END))::numeric,
           2
         )
       END::numeric(14,2) AS valor_medio,
       NOW() AS atualizado_em
     FROM despesa_itens i
     LEFT JOIN despesa_lancamentos l
       ON l.item_saida_id = i.id
      AND l.competencia_ano = $1
     GROUP BY i.id
     ON CONFLICT (item_saida_id, ano) DO UPDATE SET
       valor_total = EXCLUDED.valor_total,
       qtd_meses_considerados = EXCLUDED.qtd_meses_considerados,
       valor_medio = EXCLUDED.valor_medio,
       atualizado_em = NOW()`,
    [anoReferencia]
  );
}

function montarWhereListagem(filtros = {}) {
  const values = [];
  const conditions = [];

  if (filtros.competencia_mes) {
    values.push(normalizarMes(filtros.competencia_mes));
    conditions.push(`s.competencia_mes = $${values.length}`);
  }

  if (filtros.competencia_ano) {
    values.push(normalizarAno(filtros.competencia_ano));
    conditions.push(`s.competencia_ano = $${values.length}`);
  }

  if (filtros.item_saida_id) {
    values.push(normalizarId(filtros.item_saida_id, 'Item de saída'));
    conditions.push(`s.item_saida_id = $${values.length}`);
  }

  if (filtros.categoria_id) {
    values.push(normalizarId(filtros.categoria_id, 'Categoria'));
    conditions.push(`i.categoria_id = $${values.length}`);
  }

  if (filtros.status) {
    values.push(normalizarStatus(filtros.status));
    conditions.push(`s.status = $${values.length}`);
  }

  const loteCarne = normalizarTexto(filtros.lote_carne);
  if (loteCarne) {
    values.push(loteCarne);
    conditions.push(`s.lote_carne = $${values.length}`);
  }

  const busca = normalizarTexto(filtros.busca);
  if (busca) {
    values.push(`%${busca}%`);
    conditions.push(`(i.nome ILIKE $${values.length} OR c.nome ILIKE $${values.length} OR COALESCE(s.observacao, '') ILIKE $${values.length})`);
  }

  const somenteComVencimento = String(filtros.somente_com_vencimento || '').toLowerCase();
  if (['1', 'true', 'sim', 's'].includes(somenteComVencimento)) {
    conditions.push('s.vencimento IS NOT NULL');
  }

  return { values, conditions };
}

async function listar(filtros = {}) {
  const { values, conditions } = montarWhereListagem(filtros);

  let query = `
    SELECT
      s.id,
      s.item_saida_id,
      i.nome AS item_saida_nome,
      i.recorrente_mensal,
      c.id AS categoria_id,
      c.nome AS categoria_nome,
      s.competencia_mes,
      s.competencia_ano,
      s.vencimento,
      s.data_saida,
      s.valor,
      s.forma_pagamento,
      s.status,
      s.observacao,
      s.lote_carne,
      s.numero_parcela,
      s.total_parcelas,
      s.created_at,
      s.updated_at
    FROM despesa_lancamentos s
    JOIN despesa_itens i ON i.id = s.item_saida_id
    JOIN despesa_categorias c ON c.id = i.categoria_id
  `;

  if (conditions.length) {
    query += ` WHERE ${conditions.join(' AND ')}`;
  }

  const ordenarPor = normalizarTexto(filtros.ordenar_por || filtros.ordenar).toLowerCase();
  if (ordenarPor === 'vencimento_desc') {
    query += `
      ORDER BY COALESCE(s.vencimento, DATE '1900-01-01') DESC,
               s.id DESC
    `;
  } else if (ordenarPor === 'vencimento_asc') {
    query += `
      ORDER BY COALESCE(s.vencimento, DATE '2999-12-31') ASC,
               s.id ASC
    `;
  } else {
    query += `
      ORDER BY s.competencia_ano DESC,
               s.competencia_mes DESC,
               COALESCE(s.vencimento, s.data_saida, DATE '1900-01-01') DESC,
               s.id DESC
    `;
  }

  const result = await pool.query(query, values);
  return result.rows;
}

async function buscar(id) {
  const result = await pool.query(
    `SELECT
       s.id,
       s.item_saida_id,
       i.nome AS item_saida_nome,
       i.recorrente_mensal,
       c.id AS categoria_id,
       c.nome AS categoria_nome,
       s.competencia_mes,
       s.competencia_ano,
       s.vencimento,
       s.data_saida,
       s.valor,
       s.forma_pagamento,
       s.status,
       s.observacao,
       s.lote_carne,
       s.numero_parcela,
       s.total_parcelas,
       s.created_at,
       s.updated_at
     FROM despesa_lancamentos s
     JOIN despesa_itens i ON i.id = s.item_saida_id
     JOIN despesa_categorias c ON c.id = i.categoria_id
     WHERE s.id = $1`,
    [normalizarId(id, 'Saída')]
  );

  if (!result.rows.length) {
    throw new Error('Lançamento de saída não encontrado');
  }

  return result.rows[0];
}

async function criar(data = {}) {
  const itemSaidaId = normalizarId(data.item_saida_id, 'Item de saída');
  const competenciaMes = normalizarMes(data.competencia_mes);
  const competenciaAno = normalizarAno(data.competencia_ano);
  const vencimento = normalizarData(data.vencimento, 'Vencimento');
  const dataSaida = normalizarData(data.data_saida, 'Data de pagamento');
  const valor = normalizarValor(data.valor);
  const formaPagamento = normalizarTexto(data.forma_pagamento) || null;
  const status = normalizarStatus(data.status);
  const observacao = normalizarTexto(data.observacao) || null;

  if (!(await itemExiste(itemSaidaId))) {
    throw new Error('Item de saída não encontrado');
  }

  const result = await pool.query(
    `INSERT INTO despesa_lancamentos
       (item_saida_id, competencia_mes, competencia_ano, vencimento, data_saida, valor, forma_pagamento, status, observacao)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id`,
    [itemSaidaId, competenciaMes, competenciaAno, vencimento, dataSaida, valor, formaPagamento, status, observacao]
  );

  await recalcularMediaAnual(itemSaidaId, competenciaAno);

  return buscar(result.rows[0].id);
}

async function criarCarne(data = {}) {
  const itemSaidaId = normalizarId(data.item_saida_id, 'Item de saída');
  const primeiroVencimento = normalizarDataObrigatoria(
    data.primeiro_vencimento || data.vencimento_inicial,
    'Primeiro vencimento'
  );
  const dataLimite = normalizarDataObrigatoria(data.data_limite, 'Data limite');
  const valor = normalizarValor(data.valor);
  const formaPagamento = normalizarTexto(data.forma_pagamento) || null;
  const observacao = normalizarTexto(data.observacao) || null;

  if (valor <= 0) {
    throw new Error('Valor da parcela deve ser maior que zero');
  }

  if (!(await itemExiste(itemSaidaId))) {
    throw new Error('Item de saída não encontrado');
  }

  const vencimentos = gerarVencimentosMensais(primeiroVencimento, dataLimite);
  const loteCarne = gerarLoteCarne();
  const totalParcelas = vencimentos.length;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    for (let index = 0; index < vencimentos.length; index += 1) {
      const parcela = vencimentos[index];
      await client.query(
        `INSERT INTO despesa_lancamentos
           (item_saida_id, competencia_mes, competencia_ano, vencimento, data_saida, valor, forma_pagamento, status, observacao, lote_carne, numero_parcela, total_parcelas)
         VALUES ($1, $2, $3, $4, NULL, $5, $6, 'PENDENTE', $7, $8, $9, $10)`,
        [
          itemSaidaId,
          parcela.mes,
          parcela.ano,
          parcela.data,
          valor,
          formaPagamento,
          observacao,
          loteCarne,
          index + 1,
          totalParcelas
        ]
      );
    }

    const anos = [...new Set(vencimentos.map(v => v.ano))];
    for (const ano of anos) {
      await recalcularMediaAnual(itemSaidaId, ano, client);
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  const parcelas = await listar({ lote_carne: loteCarne });

  return {
    lote_carne: loteCarne,
    total_parcelas: totalParcelas,
    primeiro_vencimento: vencimentos[0].data,
    ultimo_vencimento: vencimentos[vencimentos.length - 1].data,
    parcelas
  };
}

async function atualizar(id, data = {}) {
  const saidaId = normalizarId(id, 'Saída');
  const atual = await buscar(saidaId);

  const itemSaidaId = data.item_saida_id !== undefined ? normalizarId(data.item_saida_id, 'Item de saída') : atual.item_saida_id;
  const competenciaMes = data.competencia_mes !== undefined ? normalizarMes(data.competencia_mes) : atual.competencia_mes;
  const competenciaAno = data.competencia_ano !== undefined ? normalizarAno(data.competencia_ano) : atual.competencia_ano;
  const vencimento = data.vencimento !== undefined
    ? normalizarData(data.vencimento, 'Vencimento')
    : dataBancoParaISO(atual.vencimento, 'Vencimento');
  const dataSaida = data.data_saida !== undefined
    ? normalizarData(data.data_saida, 'Data de pagamento')
    : dataBancoParaISO(atual.data_saida, 'Data de pagamento');
  const valor = data.valor !== undefined ? normalizarValor(data.valor) : Number(atual.valor);
  const formaPagamento = data.forma_pagamento !== undefined ? (normalizarTexto(data.forma_pagamento) || null) : atual.forma_pagamento;
  const status = data.status !== undefined ? normalizarStatus(data.status) : atual.status;
  const observacao = data.observacao !== undefined ? (normalizarTexto(data.observacao) || null) : atual.observacao;

  if (!(await itemExiste(itemSaidaId))) {
    throw new Error('Item de saída não encontrado');
  }

  await pool.query(
    `UPDATE despesa_lancamentos
     SET item_saida_id = $1,
         competencia_mes = $2,
         competencia_ano = $3,
         vencimento = $4,
         data_saida = $5,
         valor = $6,
         forma_pagamento = $7,
         status = $8,
         observacao = $9,
         updated_at = NOW()
     WHERE id = $10`,
    [itemSaidaId, competenciaMes, competenciaAno, vencimento, dataSaida, valor, formaPagamento, status, observacao, saidaId]
  );

  await recalcularMediasAnuais([
    { item_saida_id: atual.item_saida_id, ano: atual.competencia_ano },
    { item_saida_id: itemSaidaId, ano: competenciaAno }
  ]);

  return buscar(saidaId);
}

async function excluir(id) {
  const saidaId = normalizarId(id, 'Saída');
  const atual = await buscar(saidaId);
  await pool.query('DELETE FROM despesa_lancamentos WHERE id = $1', [saidaId]);
  await recalcularMediaAnual(atual.item_saida_id, atual.competencia_ano);
}

async function totaisPorCategoria(mes, ano) {
  const result = await pool.query(
    `SELECT
       c.id AS categoria_id,
       c.nome AS categoria_nome,
       SUM(CASE WHEN s.status = 'PAGO' THEN s.valor ELSE 0 END)::numeric(14,2) AS total_pago,
       SUM(CASE WHEN s.status = 'PENDENTE' THEN s.valor ELSE 0 END)::numeric(14,2) AS total_pendente,
       SUM(CASE WHEN s.status <> 'CANCELADO' THEN s.valor ELSE 0 END)::numeric(14,2) AS total_considerado
     FROM despesa_lancamentos s
     JOIN despesa_itens i ON i.id = s.item_saida_id
     JOIN despesa_categorias c ON c.id = i.categoria_id
     WHERE s.competencia_mes = $1
       AND s.competencia_ano = $2
     GROUP BY c.id, c.nome
     ORDER BY c.nome ASC`,
    [mes, ano]
  );

  return result.rows;
}

async function faltantesRecorrentes(mes, ano) {
  const competenciaMes = normalizarMes(mes);
  const competenciaAno = normalizarAno(ano);

  const result = await pool.query(
    `SELECT
       i.id AS item_saida_id,
       i.nome AS item_saida_nome,
       c.id AS categoria_id,
       c.nome AS categoria_nome,
       ult.valor AS ultimo_valor_pago,
       ult.competencia_mes AS ultimo_mes_pago,
       ult.competencia_ano AS ultimo_ano_pago,
       ult.vencimento AS ultimo_vencimento,
       ult.data_saida AS ultima_data_saida
     FROM despesa_itens i
     JOIN despesa_categorias c ON c.id = i.categoria_id
     LEFT JOIN LATERAL (
       SELECT s2.valor, s2.competencia_mes, s2.competencia_ano, s2.vencimento, s2.data_saida
       FROM despesa_lancamentos s2
       WHERE s2.item_saida_id = i.id
         AND s2.status = 'PAGO'
         AND (
           s2.competencia_ano < $2
           OR (s2.competencia_ano = $2 AND s2.competencia_mes < $1)
         )
       ORDER BY s2.competencia_ano DESC,
                s2.competencia_mes DESC,
                COALESCE(s2.vencimento, s2.data_saida, DATE '1900-01-01') DESC,
                s2.id DESC
       LIMIT 1
     ) ult ON TRUE
     WHERE i.ativo = TRUE
       AND i.recorrente_mensal = TRUE
       AND NOT EXISTS (
         SELECT 1
         FROM despesa_lancamentos s
         WHERE s.item_saida_id = i.id
           AND s.competencia_mes = $1
           AND s.competencia_ano = $2
           AND s.status <> 'CANCELADO'
       )
     ORDER BY c.nome ASC, i.nome ASC`,
    [competenciaMes, competenciaAno]
  );

  return result.rows;
}

async function comparativoMes(mes, ano) {
  const competenciaMes = normalizarMes(mes);
  const competenciaAno = normalizarAno(ano);
  const anterior = mesAnterior(competenciaMes, competenciaAno);

  const result = await pool.query(
    `WITH atual AS (
       SELECT item_saida_id, SUM(valor)::numeric(14,2) AS valor_atual
       FROM despesa_lancamentos
       WHERE competencia_mes = $1
         AND competencia_ano = $2
         AND status <> 'CANCELADO'
       GROUP BY item_saida_id
     ), anterior AS (
       SELECT item_saida_id, SUM(valor)::numeric(14,2) AS valor_anterior
       FROM despesa_lancamentos
       WHERE competencia_mes = $3
         AND competencia_ano = $4
         AND status <> 'CANCELADO'
       GROUP BY item_saida_id
     )
     SELECT
       i.id AS item_saida_id,
       i.nome AS item_saida_nome,
       c.nome AS categoria_nome,
       COALESCE(a.valor_atual, 0)::numeric(14,2) AS valor_atual,
       COALESCE(p.valor_anterior, 0)::numeric(14,2) AS valor_anterior,
       (COALESCE(a.valor_atual, 0) - COALESCE(p.valor_anterior, 0))::numeric(14,2) AS diferenca,
       CASE
         WHEN COALESCE(p.valor_anterior, 0) = 0 AND COALESCE(a.valor_atual, 0) > 0 THEN NULL
         WHEN COALESCE(p.valor_anterior, 0) = 0 THEN 0
         ELSE ROUND(((COALESCE(a.valor_atual, 0) - COALESCE(p.valor_anterior, 0)) / p.valor_anterior) * 100, 2)
       END AS variacao_percentual,
       CASE
         WHEN COALESCE(a.valor_atual, 0) > COALESCE(p.valor_anterior, 0) THEN 'SUBIU'
         WHEN COALESCE(a.valor_atual, 0) < COALESCE(p.valor_anterior, 0) THEN 'CAIU'
         ELSE 'IGUAL'
       END AS situacao
     FROM despesa_itens i
     JOIN despesa_categorias c ON c.id = i.categoria_id
     LEFT JOIN atual a ON a.item_saida_id = i.id
     LEFT JOIN anterior p ON p.item_saida_id = i.id
     WHERE COALESCE(a.valor_atual, 0) > 0
        OR COALESCE(p.valor_anterior, 0) > 0
        OR (i.ativo = TRUE AND i.recorrente_mensal = TRUE)
     ORDER BY c.nome ASC, i.nome ASC`,
    [competenciaMes, competenciaAno, anterior.mes, anterior.ano]
  );

  return result.rows.map(row => ({
    ...row,
    mes_anterior: anterior.mes,
    ano_anterior: anterior.ano
  }));
}


async function relatorioMediasAnuais(filtros = {}) {
  const hoje = new Date();
  const ano = filtros.ano ? normalizarAno(filtros.ano) : hoje.getFullYear();

  await recalcularTodasMediasAno(ano);

  const result = await pool.query(
    `SELECT
       c.id AS categoria_id,
       c.nome AS categoria_nome,
       c.ativo AS categoria_ativa,
       i.id AS item_saida_id,
       i.nome AS item_saida_nome,
       i.ativo AS item_ativo,
       i.recorrente_mensal,
       COALESCE(m.valor_total, 0)::numeric(14,2) AS valor_total,
       COALESCE(m.qtd_meses_considerados, 0)::int AS qtd_meses_considerados,
       COALESCE(m.valor_medio, 0)::numeric(14,2) AS valor_medio,
       m.atualizado_em
     FROM despesa_categorias c
     LEFT JOIN despesa_itens i ON i.categoria_id = c.id
     LEFT JOIN despesa_item_medias_anuais m
       ON m.item_saida_id = i.id
      AND m.ano = $1
     ORDER BY c.nome ASC, i.nome ASC`,
    [ano]
  );

  const mapaCategorias = new Map();

  result.rows.forEach(row => {
    if (!mapaCategorias.has(row.categoria_id)) {
      mapaCategorias.set(row.categoria_id, {
        categoria_id: row.categoria_id,
        categoria_nome: row.categoria_nome,
        categoria_ativa: row.categoria_ativa,
        itens: [],
        total_categoria: 0
      });
    }

    const categoria = mapaCategorias.get(row.categoria_id);

    if (row.item_saida_id) {
      const valorMedio = Number(row.valor_medio || 0);
      categoria.itens.push({
        item_saida_id: row.item_saida_id,
        item_saida_nome: row.item_saida_nome,
        item_ativo: row.item_ativo,
        recorrente_mensal: row.recorrente_mensal,
        valor_total: Number(row.valor_total || 0),
        qtd_meses_considerados: Number(row.qtd_meses_considerados || 0),
        valor_medio: valorMedio,
        atualizado_em: row.atualizado_em
      });
      categoria.total_categoria += valorMedio;
    }
  });

  const categorias = Array.from(mapaCategorias.values()).map(categoria => ({
    ...categoria,
    total_categoria: Number(categoria.total_categoria.toFixed(2))
  }));

  const totalGeral = categorias.reduce((acc, categoria) => acc + Number(categoria.total_categoria || 0), 0);

  return {
    ano,
    categorias,
    totais: {
      total_geral_medio_mensal: Number(totalGeral.toFixed(2)),
      quantidade_categorias: categorias.length,
      quantidade_itens: categorias.reduce((acc, categoria) => acc + categoria.itens.length, 0)
    }
  };
}

async function relatorioMensal(filtros = {}) {
  const hoje = new Date();
  const mes = filtros.mes ? normalizarMes(filtros.mes) : hoje.getMonth() + 1;
  const ano = filtros.ano ? normalizarAno(filtros.ano) : hoje.getFullYear();
  const quantidadeItensVendidos = filtros.quantidade_itens_vendidos
    ? Number(String(filtros.quantidade_itens_vendidos).replace(',', '.'))
    : 0;

  if (quantidadeItensVendidos < 0 || !Number.isFinite(quantidadeItensVendidos)) {
    throw new Error('Quantidade de itens vendidos inválida');
  }

  const lancamentos = await listar({ competencia_mes: mes, competencia_ano: ano });
  const categorias = await totaisPorCategoria(mes, ano);
  const faltantes = await faltantesRecorrentes(mes, ano);
  const comparativo = await comparativoMes(mes, ano);

  const totalPago = lancamentos
    .filter(item => item.status === 'PAGO')
    .reduce((acc, item) => acc + Number(item.valor || 0), 0);

  const totalPendenteLancado = lancamentos
    .filter(item => item.status === 'PENDENTE')
    .reduce((acc, item) => acc + Number(item.valor || 0), 0);

  const totalCancelado = lancamentos
    .filter(item => item.status === 'CANCELADO')
    .reduce((acc, item) => acc + Number(item.valor || 0), 0);

  const totalPrevistoFaltante = faltantes
    .reduce((acc, item) => acc + Number(item.ultimo_valor_pago || 0), 0);

  const totalConsiderado = totalPago + totalPendenteLancado + totalPrevistoFaltante;
  const custoMedioItem = quantidadeItensVendidos > 0 ? totalConsiderado / quantidadeItensVendidos : null;

  return {
    periodo: { mes, ano },
    quantidade_itens_vendidos: quantidadeItensVendidos,
    totais: {
      total_pago: Number(totalPago.toFixed(2)),
      total_pendente_lancado: Number(totalPendenteLancado.toFixed(2)),
      total_cancelado: Number(totalCancelado.toFixed(2)),
      total_previsto_faltante: Number(totalPrevistoFaltante.toFixed(2)),
      total_considerado: Number(totalConsiderado.toFixed(2)),
      custo_medio_por_item: custoMedioItem === null ? null : Number(custoMedioItem.toFixed(2))
    },
    por_categoria: categorias,
    lancamentos,
    pendentes_lancadas: lancamentos.filter(item => item.status === 'PENDENTE'),
    faltantes_recorrentes: faltantes,
    comparativo
  };
}

module.exports = {
  listar,
  buscar,
  criar,
  criarCarne,
  atualizar,
  excluir,
  relatorioMensal,
  relatorioMediasAnuais,
  faltantesRecorrentes,
  comparativoMes,
  recalcularMediaAnual,
  recalcularTodasMediasAno,
  STATUS_VALIDOS
};
