const pool = require('../../../db/connection');
const fechamentoMensalService = require('../fechamento-mensal/fechamento-mensal.service');

function moedaNumero(value) {
  return Number(value || 0);
}

function normalizarTexto(value) {
  return String(value || '').trim();
}

function mapearProduto(row) {
  const custo = moedaNumero(row.custo);
  const precoVenda = moedaNumero(row.preco_venda);
  const lucro = Number((precoVenda - custo).toFixed(4));
  const totalItens = Number(row.total_itens || 0);
  const semComposicao = !row.composicao_id;
  const custoZerado = custo <= 0;
  const lucroNegativo = lucro < 0;
  const erro = custoZerado || lucroNegativo;

  return {
    produto_id: Number(row.produto_id),
    produto: row.produto,
    composicao_id: row.composicao_id ? Number(row.composicao_id) : null,
    custo,
    preco_venda: precoVenda,
    lucro,
    total_itens: totalItens,
    sem_composicao: semComposicao,
    custo_zerado: custoZerado,
    lucro_negativo: lucroNegativo,
    erro
  };
}

async function listar(filtros = {}) {
  const values = [];
  const conditions = [];

  if (filtros.busca) {
    values.push(`%${normalizarTexto(filtros.busca)}%`);
    conditions.push(`p.nome ILIKE $${values.length}`);
  }

  const apenasAtivos = filtros.ativos === undefined || filtros.ativos === 'true' || filtros.ativos === true;
  if (apenasAtivos) {
    conditions.push('p.ativo = TRUE');
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const result = await pool.query(`
    SELECT
      p.id AS produto_id,
      p.nome AS produto,
      p.preco AS preco_venda,
      pc.id AS composicao_id,
      COUNT(pci.id)::int AS total_itens,
      COALESCE(SUM(
        pci.quantidade *
        CASE
          WHEN d.insumo_id IS NOT NULL THEN COALESCE(d.peso_kg, 0) * COALESCE(ifn.custo_final, 0)
          ELSE COALESCE(ifn.custo_final, 0)
        END
      ), 0)::numeric(14,4) AS custo
    FROM produtos p
    LEFT JOIN produtos_composicoes pc ON pc.produto_id = p.id
    LEFT JOIN produtos_composicoes_itens pci ON pci.composicao_id = pc.id
    LEFT JOIN insumos_fornecedores ifn ON ifn.id = pci.insumo_fornecedor_id
    LEFT JOIN insumos i ON i.id = ifn.insumo_id
    LEFT JOIN insumos_discos d ON d.insumo_id = i.id
    ${where}
    GROUP BY p.id, p.nome, p.preco, pc.id
    ORDER BY p.nome ASC
  `, values);

  let produtos = result.rows.map(mapearProduto);

  const status = filtros.status || 'todos';
  if (status === 'erro') {
    produtos = produtos.filter(item => item.erro);
  } else if (status === 'custo_zerado') {
    produtos = produtos.filter(item => item.custo_zerado);
  } else if (status === 'lucro_negativo') {
    produtos = produtos.filter(item => item.lucro_negativo);
  } else if (status === 'ok') {
    produtos = produtos.filter(item => !item.erro);
  }

  const totais = produtos.reduce((acc, item) => {
    acc.total_produtos += 1;
    acc.total_erros += item.erro ? 1 : 0;
    acc.total_custo_zerado += item.custo_zerado ? 1 : 0;
    acc.total_lucro_negativo += item.lucro_negativo ? 1 : 0;
    return acc;
  }, {
    total_produtos: 0,
    total_erros: 0,
    total_custo_zerado: 0,
    total_lucro_negativo: 0
  });

  return { produtos, totais };
}


function periodoCorrente() {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Fortaleza', year: 'numeric', month: '2-digit'
  }).formatToParts(new Date());
  const data = Object.fromEntries(partes.map(parte => [parte.type, parte.value]));
  const atual = { mes: Number(data.month), ano: Number(data.year) };
  const anterior = atual.mes === 1
    ? { mes: 12, ano: atual.ano - 1 }
    : { mes: atual.mes - 1, ano: atual.ano };
  return { anterior, atual };
}

async function apurarRateio(periodo) {
  const fechamento = await fechamentoMensalService.carregar(periodo);
  const totais = fechamento.totais || {};
  const despesas = Number(totais.total_despesas_pagas);
  const quantidade = Number(totais.quantidade_itens_vendidos);
  if (!Number.isFinite(despesas) || !Number.isFinite(quantidade) || despesas < 0 || quantidade < 0) {
    throw new Error('Despesas ou quantidade vendida inválidas no fechamento mensal.');
  }
  return {
    ...periodo,
    total_despesas_pagas: despesas,
    itens_vendidos: quantidade,
    custo_fixo_por_item: quantidade > 0 ? Number((despesas / quantidade).toFixed(4)) : null,
    erro: quantidade > 0 ? null : 'Sem itens vendidos no período.'
  };
}

// Relatório de precificação: não altera o lucro bruto da API tradicional,
// que é utilizado por outros módulos do sistema.
async function listarPrecificacao(filtros = {}) {
  const [base, periodos] = await Promise.all([
    listar({ ...filtros, status: 'todos' }),
    Promise.resolve(periodoCorrente())
  ]);
  const periodosSolicitados = [periodos.anterior, periodos.atual];
  const resultados = await Promise.allSettled(periodosSolicitados.map(apurarRateio));
  const montarPeriodo = (periodo, resultado) => resultado.status === 'fulfilled'
    ? resultado.value
    : {
        ...periodo,
        total_despesas_pagas: null,
        itens_vendidos: null,
        custo_fixo_por_item: null,
        erro: resultado.reason?.message || 'Fechamento mensal indisponível.'
      };
  const mesAnterior = montarPeriodo(periodos.anterior, resultados[0]);
  const mesAtual = montarPeriodo(periodos.atual, resultados[1]);
  const custoFixoAtual = mesAtual.custo_fixo_por_item;

  let produtos = base.produtos.map(item => {
    const lucroLiquido = custoFixoAtual === null ? null
      : Number((item.preco_venda - item.custo - custoFixoAtual).toFixed(4));
    return {
      ...item,
      custo_fixo_mes_anterior: mesAnterior.custo_fixo_por_item,
      custo_fixo_mes_atual: custoFixoAtual,
      lucro_liquido: lucroLiquido,
      lucro_liquido_negativo: lucroLiquido === null ? false : lucroLiquido < 0,
      erro_precificacao: item.custo_zerado || (lucroLiquido !== null && lucroLiquido < 0)
    };
  });

  const status = filtros.status || 'todos';
  if (status === 'erro') {
    produtos = produtos.filter(item => item.erro_precificacao);
  } else if (status === 'custo_zerado') {
    produtos = produtos.filter(item => item.custo_zerado);
  } else if (status === 'lucro_negativo') {
    produtos = produtos.filter(item => item.lucro_liquido_negativo);
  } else if (status === 'ok') {
    produtos = produtos.filter(item => !item.erro_precificacao && item.lucro_liquido !== null);
  }

  const totais = produtos.reduce((acc, item) => {
    acc.total_produtos += 1;
    acc.total_erros += item.erro_precificacao ? 1 : 0;
    acc.total_custo_zerado += item.custo_zerado ? 1 : 0;
    acc.total_lucro_negativo += item.lucro_liquido_negativo ? 1 : 0;
    return acc;
  }, { total_produtos: 0, total_erros: 0, total_custo_zerado: 0, total_lucro_negativo: 0 });

  return {
    produtos,
    totais,
    rateios: { mes_anterior: mesAnterior, mes_atual: mesAtual },
    regra: 'Despesas pagas em cada mês divididas pelos itens vendidos nas carradas daquele mês. Lucro = preço de venda - custo do produto - rateio do mês atual.'
  };
}

async function atualizarPrecoVenda(produtoId, valor) {
  const id = Number(produtoId);
  const preco = Number(typeof valor === 'string' ? valor.trim().replace(',', '.') : valor);
  if (!Number.isSafeInteger(id) || id <= 0) {
    const erro = new Error('Produto inválido.');
    erro.status = 400;
    throw erro;
  }
  if (valor === undefined || valor === null || valor === '' ||
      !Number.isFinite(preco) || preco < 0 || preco > 999999999 ||
      Math.abs(preco * 100 - Math.round(preco * 100)) > 0.00001) {
    const erro = new Error('Preço inválido. Informe um valor positivo ou zero, com até duas casas decimais.');
    erro.status = 400;
    throw erro;
  }
  const atualizacao = await pool.query(
    'UPDATE produtos SET preco = $1, updated_at = NOW() WHERE id = $2 RETURNING id, nome, preco',
    [Math.round(preco * 100) / 100, id]
  );
  if (!atualizacao.rows.length) {
    const erro = new Error('Produto não encontrado.');
    erro.status = 404;
    throw erro;
  }
  const produto = atualizacao.rows[0];
  return { produto_id: Number(produto.id), produto: produto.nome, preco: Number(produto.preco) };
}

module.exports = {
  listar,
  listarPrecificacao,
  atualizarPrecoVenda
};
