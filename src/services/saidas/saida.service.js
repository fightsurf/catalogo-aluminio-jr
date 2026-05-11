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
  return texto;
}

function mesAnterior(mes, ano) {
  if (mes === 1) return { mes: 12, ano: ano - 1 };
  return { mes: mes - 1, ano };
}

async function itemExiste(id) {
  const result = await pool.query('SELECT id FROM saida_itens WHERE id = $1', [normalizarId(id, 'Item de saída')]);
  return result.rows.length > 0;
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

  const busca = normalizarTexto(filtros.busca);
  if (busca) {
    values.push(`%${busca}%`);
    conditions.push(`(i.nome ILIKE $${values.length} OR c.nome ILIKE $${values.length} OR COALESCE(s.observacao, '') ILIKE $${values.length})`);
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
      s.created_at,
      s.updated_at
    FROM saidas s
    JOIN saida_itens i ON i.id = s.item_saida_id
    JOIN saida_categorias c ON c.id = i.categoria_id
  `;

  if (conditions.length) {
    query += ` WHERE ${conditions.join(' AND ')}`;
  }

  query += `
    ORDER BY s.competencia_ano DESC,
             s.competencia_mes DESC,
             COALESCE(s.vencimento, s.data_saida, DATE '1900-01-01') DESC,
             s.id DESC
  `;

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
       s.created_at,
       s.updated_at
     FROM saidas s
     JOIN saida_itens i ON i.id = s.item_saida_id
     JOIN saida_categorias c ON c.id = i.categoria_id
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
    `INSERT INTO saidas
       (item_saida_id, competencia_mes, competencia_ano, vencimento, data_saida, valor, forma_pagamento, status, observacao)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id`,
    [itemSaidaId, competenciaMes, competenciaAno, vencimento, dataSaida, valor, formaPagamento, status, observacao]
  );

  return buscar(result.rows[0].id);
}

async function atualizar(id, data = {}) {
  const saidaId = normalizarId(id, 'Saída');
  const atual = await buscar(saidaId);

  const itemSaidaId = data.item_saida_id !== undefined ? normalizarId(data.item_saida_id, 'Item de saída') : atual.item_saida_id;
  const competenciaMes = data.competencia_mes !== undefined ? normalizarMes(data.competencia_mes) : atual.competencia_mes;
  const competenciaAno = data.competencia_ano !== undefined ? normalizarAno(data.competencia_ano) : atual.competencia_ano;
  const vencimento = data.vencimento !== undefined ? normalizarData(data.vencimento, 'Vencimento') : (atual.vencimento ? String(atual.vencimento).slice(0, 10) : null);
  const dataSaida = data.data_saida !== undefined ? normalizarData(data.data_saida, 'Data de pagamento') : (atual.data_saida ? String(atual.data_saida).slice(0, 10) : null);
  const valor = data.valor !== undefined ? normalizarValor(data.valor) : Number(atual.valor);
  const formaPagamento = data.forma_pagamento !== undefined ? (normalizarTexto(data.forma_pagamento) || null) : atual.forma_pagamento;
  const status = data.status !== undefined ? normalizarStatus(data.status) : atual.status;
  const observacao = data.observacao !== undefined ? (normalizarTexto(data.observacao) || null) : atual.observacao;

  if (!(await itemExiste(itemSaidaId))) {
    throw new Error('Item de saída não encontrado');
  }

  await pool.query(
    `UPDATE saidas
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

  return buscar(saidaId);
}

async function excluir(id) {
  const saidaId = normalizarId(id, 'Saída');
  await buscar(saidaId);
  await pool.query('DELETE FROM saidas WHERE id = $1', [saidaId]);
}

async function totaisPorCategoria(mes, ano) {
  const result = await pool.query(
    `SELECT
       c.id AS categoria_id,
       c.nome AS categoria_nome,
       SUM(CASE WHEN s.status = 'PAGO' THEN s.valor ELSE 0 END)::numeric(14,2) AS total_pago,
       SUM(CASE WHEN s.status = 'PENDENTE' THEN s.valor ELSE 0 END)::numeric(14,2) AS total_pendente,
       SUM(CASE WHEN s.status <> 'CANCELADO' THEN s.valor ELSE 0 END)::numeric(14,2) AS total_considerado
     FROM saidas s
     JOIN saida_itens i ON i.id = s.item_saida_id
     JOIN saida_categorias c ON c.id = i.categoria_id
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
     FROM saida_itens i
     JOIN saida_categorias c ON c.id = i.categoria_id
     LEFT JOIN LATERAL (
       SELECT s2.valor, s2.competencia_mes, s2.competencia_ano, s2.vencimento, s2.data_saida
       FROM saidas s2
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
         FROM saidas s
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
       FROM saidas
       WHERE competencia_mes = $1
         AND competencia_ano = $2
         AND status <> 'CANCELADO'
       GROUP BY item_saida_id
     ), anterior AS (
       SELECT item_saida_id, SUM(valor)::numeric(14,2) AS valor_anterior
       FROM saidas
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
     FROM saida_itens i
     JOIN saida_categorias c ON c.id = i.categoria_id
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
  atualizar,
  excluir,
  relatorioMensal,
  faltantesRecorrentes,
  comparativoMes,
  STATUS_VALIDOS
};
