const pool = require('../../../db/connection');
const legadoBridgeService = require('../legado/legadoBridge.service');

function normalizarMes(valor) {
  const mes = Number.parseInt(valor, 10);
  if (!Number.isInteger(mes) || mes < 1 || mes > 12) {
    throw new Error('Mês inválido. Informe um valor entre 1 e 12.');
  }
  return mes;
}

function normalizarAno(valor) {
  const ano = Number.parseInt(valor, 10);
  if (!Number.isInteger(ano) || ano < 2000 || ano > 2100) {
    throw new Error('Ano inválido.');
  }
  return ano;
}

function hojeFortaleza() {
  const agora = new Date();
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Fortaleza',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(agora);

  const mapa = Object.fromEntries(partes.map((parte) => [parte.type, parte.value]));
  return {
    ano: Number(mapa.year),
    mes: Number(mapa.month),
    dia: Number(mapa.day)
  };
}

function resolverPeriodo(filtros = {}) {
  const hoje = hojeFortaleza();
  const mes = filtros.mes ? normalizarMes(filtros.mes) : hoje.mes;
  const ano = filtros.ano ? normalizarAno(filtros.ano) : hoje.ano;
  const inicio = `${ano}-${String(mes).padStart(2, '0')}-01`;
  const proximoMes = mes === 12 ? 1 : mes + 1;
  const proximoAno = mes === 12 ? ano + 1 : ano;
  const fimExclusivo = `${proximoAno}-${String(proximoMes).padStart(2, '0')}-01`;

  return { mes, ano, inicio, fimExclusivo };
}

function arredondar(valor, casas = 2) {
  const numero = Number(valor || 0);
  if (!Number.isFinite(numero)) return 0;
  return Number(numero.toFixed(casas));
}

async function buscarItensVendidosLegado(periodo) {
  const response = await legadoBridgeService.get('/api/fechamento-mensal/itens-vendidos', {
    mes: periodo.mes,
    ano: periodo.ano
  });

  return response.dados || {
    periodo: { mes: periodo.mes, ano: periodo.ano },
    totais: {
      quantidade_carradas: 0,
      quantidade_pedidos: 0,
      quantidade_itens_vendidos: 0,
      valor_total_itens: 0,
      valor_total_vendido: 0
    },
    carradas: [],
    itens: []
  };
}

async function buscarDespesasPagas(periodo) {
  const lancamentosResult = await pool.query(
    `SELECT
       s.id,
       s.item_saida_id,
       i.nome AS item_saida_nome,
       c.id AS categoria_id,
       c.nome AS categoria_nome,
       s.competencia_mes,
       s.competencia_ano,
       s.vencimento,
       s.data_saida,
       s.valor,
       s.forma_pagamento,
       s.status,
       s.observacao
     FROM despesa_lancamentos s
     JOIN despesa_itens i ON i.id = s.item_saida_id
     JOIN despesa_categorias c ON c.id = i.categoria_id
     WHERE s.status = 'PAGO'
       AND s.data_saida >= $1::date
       AND s.data_saida < $2::date
     ORDER BY s.data_saida ASC, c.nome ASC, i.nome ASC, s.id ASC`,
    [periodo.inicio, periodo.fimExclusivo]
  );

  const categoriasResult = await pool.query(
    `SELECT
       c.id AS categoria_id,
       c.nome AS categoria_nome,
       COUNT(*)::int AS quantidade_lancamentos,
       COALESCE(SUM(s.valor), 0)::numeric(14,2) AS total_pago
     FROM despesa_lancamentos s
     JOIN despesa_itens i ON i.id = s.item_saida_id
     JOIN despesa_categorias c ON c.id = i.categoria_id
     WHERE s.status = 'PAGO'
       AND s.data_saida >= $1::date
       AND s.data_saida < $2::date
     GROUP BY c.id, c.nome
     ORDER BY c.nome ASC`,
    [periodo.inicio, periodo.fimExclusivo]
  );

  const lancamentos = lancamentosResult.rows.map((row) => ({
    ...row,
    valor: arredondar(row.valor)
  }));

  const porCategoria = categoriasResult.rows.map((row) => ({
    ...row,
    total_pago: arredondar(row.total_pago)
  }));

  const totalPago = lancamentos.reduce((acc, item) => acc + Number(item.valor || 0), 0);

  return {
    regra: 'Despesas pagas pelo campo data_saida dentro do mês selecionado, com status PAGO.',
    total_pago: arredondar(totalPago),
    quantidade_lancamentos: lancamentos.length,
    por_categoria: porCategoria,
    lancamentos
  };
}

async function carregar(filtros = {}) {
  const periodo = resolverPeriodo(filtros);
  const [vendidos, despesasPagas] = await Promise.all([
    buscarItensVendidosLegado(periodo),
    buscarDespesasPagas(periodo)
  ]);

  const quantidadeItensVendidos = Number(vendidos?.totais?.quantidade_itens_vendidos || 0);
  const totalDespesasPagas = Number(despesasPagas.total_pago || 0);
  const despesaMediaPorItem = quantidadeItensVendidos > 0
    ? totalDespesasPagas / quantidadeItensVendidos
    : null;

  return {
    periodo: {
      mes: periodo.mes,
      ano: periodo.ano,
      data_inicial: periodo.inicio,
      data_final_exclusiva: periodo.fimExclusivo
    },
    regras: {
      itens_vendidos: 'Contados pelas carradas cuja data está dentro do mês selecionado.',
      despesas_pagas: despesasPagas.regra,
      calculo: 'Despesa média por item vendido = total de despesas pagas no mês / quantidade de itens vendidos no mês.'
    },
    totais: {
      quantidade_carradas: Number(vendidos?.totais?.quantidade_carradas || 0),
      quantidade_pedidos: Number(vendidos?.totais?.quantidade_pedidos || 0),
      quantidade_itens_vendidos: arredondar(quantidadeItensVendidos, 3),
      valor_total_vendido: arredondar(vendidos?.totais?.valor_total_vendido || 0),
      valor_total_itens: arredondar(vendidos?.totais?.valor_total_itens || 0),
      total_despesas_pagas: arredondar(totalDespesasPagas),
      quantidade_despesas_pagas: Number(despesasPagas.quantidade_lancamentos || 0),
      despesa_media_por_item_vendido: despesaMediaPorItem === null ? null : arredondar(despesaMediaPorItem)
    },
    carradas: Array.isArray(vendidos?.carradas) ? vendidos.carradas : [],
    itens_vendidos: Array.isArray(vendidos?.itens) ? vendidos.itens : [],
    despesas_pagas: despesasPagas.lancamentos,
    despesas_por_categoria: despesasPagas.por_categoria
  };
}

module.exports = {
  carregar
};
