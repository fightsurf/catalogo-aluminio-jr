const pool = require('../../../db/connection');
const legadoBridgeService = require('../legado/legadoBridge.service');
const schemaService = require('./termometroSchema.service');
const produtoFotosSchemaService = require('../produto/produtoFotosSchema.service');

function hojeFortaleza() {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Fortaleza',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());

  const mapa = Object.fromEntries(partes.map((parte) => [parte.type, parte.value]));
  return {
    ano: Number(mapa.year),
    mes: Number(mapa.month)
  };
}

function normalizarMes(valor, fallback) {
  const bruto = valor === undefined || valor === null || valor === '' ? fallback : valor;
  const mes = Number.parseInt(bruto, 10);
  if (!Number.isInteger(mes) || mes < 1 || mes > 12) {
    throw new Error('Mês inválido. Informe um valor entre 1 e 12.');
  }
  return mes;
}

function normalizarAno(valor, fallback) {
  const bruto = valor === undefined || valor === null || valor === '' ? fallback : valor;
  const ano = Number.parseInt(bruto, 10);
  if (!Number.isInteger(ano) || ano < 2000 || ano > 2100) {
    throw new Error('Ano inválido.');
  }
  return ano;
}

function normalizarProdutoId(valor) {
  const produtoId = Number.parseInt(valor, 10);
  if (!Number.isInteger(produtoId) || produtoId <= 0) {
    throw new Error('Produto inválido.');
  }
  return produtoId;
}

function normalizarQuantidadeMeses(valor, fallback = 12) {
  const bruto = valor === undefined || valor === null || valor === '' ? fallback : valor;
  const meses = Number.parseInt(bruto, 10);
  if (!Number.isInteger(meses) || meses < 1 || meses > 36) {
    throw new Error('Quantidade de meses inválida. Informe um valor entre 1 e 36.');
  }
  return meses;
}

function periodoMes(mes, ano) {
  const proximoMes = mes === 12 ? 1 : mes + 1;
  const proximoAno = mes === 12 ? ano + 1 : ano;
  return {
    mes,
    ano,
    inicio: `${ano}-${String(mes).padStart(2, '0')}-01T00:00:00-03:00`,
    fim: `${proximoAno}-${String(proximoMes).padStart(2, '0')}-01T00:00:00-03:00`
  };
}

function numero(valor, casas = null) {
  const n = Number(valor || 0);
  if (!Number.isFinite(n)) return 0;
  return casas === null ? n : Number(n.toFixed(casas));
}

function mediana(valores) {
  const lista = valores
    .map(Number)
    .filter((valor) => Number.isFinite(valor) && valor > 0)
    .sort((a, b) => a - b);

  if (!lista.length) return 0;
  const meio = Math.floor(lista.length / 2);
  return lista.length % 2
    ? lista[meio]
    : (lista[meio - 1] + lista[meio]) / 2;
}

function classificarProduto(item, referencias) {
  if (!item.item_legado) {
    return {
      codigo: 'sem_vinculo',
      rotulo: 'SEM VÍNCULO',
      descricao: 'Produto sem ITEM legado; as vendas não podem ser cruzadas ainda.',
      prioridade: 70
    };
  }

  const aparicoes = numero(item.aparicoes);
  const vendas = numero(item.vendas);
  const medAparicoes = numero(referencias.mediana_aparicoes) || 1;
  const medVendas = numero(referencias.mediana_vendas) || 1;

  if (aparicoes === 0 && vendas > 0) {
    return {
      codigo: 'esquecido',
      rotulo: 'VENDENDO SEM DIVULGAÇÃO',
      descricao: 'Tem venda no mês, mas não apareceu no Status Zap, na Central de Ofertas nem no Status Vídeos.',
      prioridade: 10
    };
  }

  if (aparicoes === 0 && vendas === 0) {
    return {
      codigo: 'nao_divulgado',
      rotulo: 'NÃO DIVULGADO',
      descricao: 'Não apareceu no mês e também não teve venda registrada.',
      prioridade: 30
    };
  }

  if (aparicoes > 0 && vendas === 0) {
    return {
      codigo: 'baixa_resposta',
      rotulo: 'SEM RESPOSTA',
      descricao: 'Recebeu exposição no mês, mas ainda não teve venda registrada.',
      prioridade: 40
    };
  }

  if (aparicoes <= medAparicoes && vendas >= medVendas) {
    return {
      codigo: 'oportunidade',
      rotulo: 'OPORTUNIDADE',
      descricao: 'Vende acima da mediana mesmo com exposição baixa ou moderada.',
      prioridade: 20
    };
  }

  if (aparicoes >= medAparicoes && vendas >= medVendas) {
    return {
      codigo: 'forte',
      rotulo: 'FORTE',
      descricao: 'Exposição e vendas estão em nível alto dentro do mês.',
      prioridade: 50
    };
  }

  if (aparicoes >= medAparicoes && vendas < medVendas) {
    return {
      codigo: 'baixa_resposta',
      rotulo: 'BAIXA RESPOSTA',
      descricao: 'A exposição está alta em relação ao conjunto, mas as vendas estão abaixo da mediana.',
      prioridade: 40
    };
  }

  return {
    codigo: 'observar',
    rotulo: 'OBSERVAR',
    descricao: 'Exposição e vendas em faixa intermediária.',
    prioridade: 60
  };
}

async function carregarProdutosAtivos() {
  await produtoFotosSchemaService.criarEstrutura();

  const result = await pool.query(`
    SELECT
      p.id,
      p.nome,
      p.preco,
      p.item_legado,
      p.ativo,
      c.id AS categoria_id,
      c.nome AS categoria
    FROM produtos p
    LEFT JOIN produtos_categorias c ON c.id = p.categoria_id
    WHERE p.ativo = true
    ORDER BY p.nome ASC
  `);

  return result.rows.map((row) => ({
    id: Number(row.id),
    nome: row.nome,
    preco: numero(row.preco, 2),
    item_legado: row.item_legado ? Number(row.item_legado) : null,
    categoria_id: row.categoria_id ? Number(row.categoria_id) : null,
    categoria: row.categoria || ''
  }));
}

async function carregarAparicoes(periodo) {
  await schemaService.criarEstrutura();

  const result = await pool.query(`
    SELECT
      produto_id,
      COUNT(*)::int AS publicacoes,
      COALESCE(SUM(quantidade), 0)::int AS aparicoes,
      COUNT(*) FILTER (WHERE origem = 'status_zap')::int AS status_publicacoes,
      COALESCE(SUM(quantidade) FILTER (WHERE origem = 'status_zap'), 0)::int AS status_aparicoes,
      COUNT(*) FILTER (WHERE origem = 'central_ofertas')::int AS ofertas_publicacoes,
      COALESCE(SUM(quantidade) FILTER (WHERE origem = 'central_ofertas'), 0)::int AS ofertas_aparicoes,
      COUNT(*) FILTER (WHERE origem = 'status_videos')::int AS videos_publicacoes,
      COALESCE(SUM(quantidade) FILTER (WHERE origem = 'status_videos'), 0)::int AS videos_aparicoes,
      MAX(publicado_em) AS ultima_aparicao
    FROM termometro_aparicoes
    WHERE publicado_em >= $1::timestamptz
      AND publicado_em < $2::timestamptz
    GROUP BY produto_id
  `, [periodo.inicio, periodo.fim]);

  return new Map(result.rows.map((row) => [Number(row.produto_id), {
    publicacoes: Number(row.publicacoes || 0),
    aparicoes: Number(row.aparicoes || 0),
    status_publicacoes: Number(row.status_publicacoes || 0),
    status_aparicoes: Number(row.status_aparicoes || 0),
    ofertas_publicacoes: Number(row.ofertas_publicacoes || 0),
    ofertas_aparicoes: Number(row.ofertas_aparicoes || 0),
    videos_publicacoes: Number(row.videos_publicacoes || 0),
    videos_aparicoes: Number(row.videos_aparicoes || 0),
    ultima_aparicao: row.ultima_aparicao || null
  }]));
}

async function carregarVendasLegado(mes, ano) {
  const response = await legadoBridgeService.get('/api/vendas/termometro-vendas/itens-mes', {
    mes,
    ano
  });

  const dados = response?.dados || {};
  const itens = Array.isArray(dados.itens) ? dados.itens : [];

  return {
    regra: dados.regra || '',
    totais: dados.totais || {},
    mapa: new Map(itens.map((item) => [Number(item.item), {
      item: Number(item.item),
      descricao: item.descricao || '',
      quantidade: numero(item.quantidade, 3),
      valor_total: numero(item.valor_total, 2),
      quantidade_pedidos: Number(item.quantidade_pedidos || 0)
    }])),
    itens
  };
}

function montarMesesHistorico(mesFinal, anoFinal, quantidade) {
  const meses = [];
  const dataFinal = new Date(Date.UTC(anoFinal, mesFinal - 1, 1));

  for (let deslocamento = quantidade - 1; deslocamento >= 0; deslocamento -= 1) {
    const data = new Date(Date.UTC(
      dataFinal.getUTCFullYear(),
      dataFinal.getUTCMonth() - deslocamento,
      1
    ));
    const ano = data.getUTCFullYear();
    const mes = data.getUTCMonth() + 1;
    meses.push({
      ano,
      mes,
      chave: `${ano}-${String(mes).padStart(2, '0')}`,
      rotulo: new Intl.DateTimeFormat('pt-BR', { month: 'short', year: '2-digit', timeZone: 'UTC' })
        .format(data)
        .replace('.', '')
    });
  }

  return meses;
}

async function carregarProdutoHistorico(produtoId) {
  const result = await pool.query(`
    SELECT
      p.id,
      p.nome,
      p.preco,
      p.item_legado,
      c.nome AS categoria
    FROM produtos p
    LEFT JOIN produtos_categorias c ON c.id = p.categoria_id
    WHERE p.id = $1
    LIMIT 1
  `, [produtoId]);

  if (!result.rows.length) {
    throw new Error('Produto não encontrado.');
  }

  const row = result.rows[0];
  return {
    id: Number(row.id),
    nome: row.nome || '',
    preco: numero(row.preco, 2),
    item_legado: row.item_legado ? Number(row.item_legado) : null,
    categoria: row.categoria || ''
  };
}

async function carregarAparicoesHistorico(produtoId, meses) {
  await schemaService.criarEstrutura();

  const primeiro = meses[0];
  const ultimo = meses[meses.length - 1];
  const proximoMes = ultimo.mes === 12 ? 1 : ultimo.mes + 1;
  const proximoAno = ultimo.mes === 12 ? ultimo.ano + 1 : ultimo.ano;
  const inicio = `${primeiro.ano}-${String(primeiro.mes).padStart(2, '0')}-01T00:00:00-03:00`;
  const fim = `${proximoAno}-${String(proximoMes).padStart(2, '0')}-01T00:00:00-03:00`;

  const result = await pool.query(`
    SELECT
      EXTRACT(YEAR FROM publicado_em AT TIME ZONE 'America/Fortaleza')::int AS ano,
      EXTRACT(MONTH FROM publicado_em AT TIME ZONE 'America/Fortaleza')::int AS mes,
      COUNT(*)::int AS publicacoes,
      COALESCE(SUM(quantidade), 0)::int AS aparicoes
    FROM termometro_aparicoes
    WHERE produto_id = $1
      AND publicado_em >= $2::timestamptz
      AND publicado_em < $3::timestamptz
    GROUP BY 1, 2
    ORDER BY 1, 2
  `, [produtoId, inicio, fim]);

  return new Map(result.rows.map((row) => [
    `${Number(row.ano)}-${String(Number(row.mes)).padStart(2, '0')}`,
    {
      publicacoes: Number(row.publicacoes || 0),
      aparicoes: Number(row.aparicoes || 0)
    }
  ]));
}

async function carregarHistoricoProduto(filtros = {}) {
  const hoje = hojeFortaleza();
  const produtoId = normalizarProdutoId(filtros.produtoId);
  const mes = normalizarMes(filtros.mes, hoje.mes);
  const ano = normalizarAno(filtros.ano, hoje.ano);
  const quantidadeMeses = normalizarQuantidadeMeses(filtros.meses, 12);
  const meses = montarMesesHistorico(mes, ano, quantidadeMeses);
  const produto = await carregarProdutoHistorico(produtoId);

  const [aparicoes, vendasResponse] = await Promise.all([
    carregarAparicoesHistorico(produtoId, meses),
    produto.item_legado
      ? legadoBridgeService.get('/api/vendas/termometro-vendas/historico-item', {
          item: produto.item_legado,
          mes,
          ano,
          meses: quantidadeMeses
        })
      : Promise.resolve({ dados: { meses: [] } })
  ]);

  const vendasRows = Array.isArray(vendasResponse?.dados?.meses) ? vendasResponse.dados.meses : [];
  const vendas = new Map(vendasRows.map((row) => [
    `${Number(row.ano)}-${String(Number(row.mes)).padStart(2, '0')}`,
    row
  ]));

  const historico = meses.map((periodo) => {
    const exposicao = aparicoes.get(periodo.chave) || { publicacoes: 0, aparicoes: 0 };
    const venda = vendas.get(periodo.chave) || {};
    const quantidadeVendida = numero(venda.quantidade, 3);
    const precoMedio = Number(venda.preco_medio || 0) > 0 ? numero(venda.preco_medio, 2) : null;
    const precoMin = Number(venda.preco_min || 0) > 0 ? numero(venda.preco_min, 2) : null;
    const precoMax = Number(venda.preco_max || 0) > 0 ? numero(venda.preco_max, 2) : null;

    return {
      ...periodo,
      publicacoes: Number(exposicao.publicacoes || 0),
      aparicoes: Number(exposicao.aparicoes || 0),
      vendas: quantidadeVendida,
      pedidos: Number(venda.quantidade_pedidos || 0),
      valor_vendido: numero(venda.valor_total, 2),
      preco_medio: precoMedio,
      preco_min: precoMin,
      preco_max: precoMax,
      vendas_por_aparicao: exposicao.aparicoes > 0
        ? numero(quantidadeVendida / Number(exposicao.aparicoes), 3)
        : null
    };
  });

  return {
    produto: {
      produto_id: produto.id,
      produto: produto.nome,
      categoria: produto.categoria,
      item_legado: produto.item_legado,
      preco_atual: produto.preco
    },
    periodo: { mes, ano, meses: quantidadeMeses },
    historico
  };
}

async function carregarTermometro(filtros = {}) {
  const hoje = hojeFortaleza();
  const mes = normalizarMes(filtros.mes, hoje.mes);
  const ano = normalizarAno(filtros.ano, hoje.ano);
  const periodo = periodoMes(mes, ano);

  const [produtos, aparicoes, vendasLegado] = await Promise.all([
    carregarProdutosAtivos(),
    carregarAparicoes(periodo),
    carregarVendasLegado(mes, ano)
  ]);

  const itensBase = produtos.map((produto) => {
    const exposicao = aparicoes.get(produto.id) || {
      publicacoes: 0,
      aparicoes: 0,
      status_publicacoes: 0,
      status_aparicoes: 0,
      ofertas_publicacoes: 0,
      ofertas_aparicoes: 0,
      videos_publicacoes: 0,
      videos_aparicoes: 0,
      ultima_aparicao: null
    };
    const venda = produto.item_legado
      ? vendasLegado.mapa.get(Number(produto.item_legado))
      : null;

    const vendas = numero(venda?.quantidade, 3);
    const valorVendido = numero(venda?.valor_total, 2);
    const vendasPorAparicao = exposicao.aparicoes > 0
      ? numero(vendas / exposicao.aparicoes, 3)
      : null;

    return {
      produto_id: produto.id,
      produto: produto.nome,
      categoria: produto.categoria,
      item_legado: produto.item_legado,
      preco_atual: produto.preco,
      ...exposicao,
      vendas,
      valor_vendido: valorVendido,
      pedidos: Number(venda?.quantidade_pedidos || 0),
      vendas_por_aparicao: vendasPorAparicao
    };
  });

  const referencias = {
    mediana_aparicoes: numero(mediana(itensBase.map((item) => item.aparicoes)), 3),
    mediana_vendas: numero(mediana(itensBase.map((item) => item.vendas)), 3)
  };

  const itens = itensBase
    .map((item) => {
      const classificacao = classificarProduto(item, referencias);
      return {
        ...item,
        classificacao: classificacao.codigo,
        classificacao_rotulo: classificacao.rotulo,
        classificacao_descricao: classificacao.descricao,
        prioridade: classificacao.prioridade
      };
    })
    .sort((a, b) => (
      a.prioridade - b.prioridade
      || a.aparicoes - b.aparicoes
      || b.vendas - a.vendas
      || a.produto.localeCompare(b.produto, 'pt-BR')
    ));

  const produtosComItemLegado = new Set(
    produtos.filter((produto) => produto.item_legado).map((produto) => Number(produto.item_legado))
  );
  const itensVendaSemVinculo = vendasLegado.itens
    .filter((item) => !produtosComItemLegado.has(Number(item.item)))
    .map((item) => ({
      item: Number(item.item),
      descricao: item.descricao || '',
      quantidade: numero(item.quantidade, 3)
    }));

  const totalAparicoes = itens.reduce((total, item) => total + Number(item.aparicoes || 0), 0);
  const totalPublicacoes = itens.reduce((total, item) => total + Number(item.publicacoes || 0), 0);
  const totalVendasMapeadas = itens.reduce((total, item) => total + Number(item.vendas || 0), 0);

  return {
    periodo: {
      mes,
      ano,
      data_inicial: `${ano}-${String(mes).padStart(2, '0')}-01`
    },
    regra: {
      aparicoes: 'Status Zap: 1 aparição por produto publicado. Central de Ofertas: cada produto do kit é contabilizado pela quantidade. Status Vídeos: os itens marcados no vídeo entram pela quantidade informada. Reenvios idempotentes não duplicam o contador.',
      vendas: vendasLegado.regra,
      cruzamento: 'O vínculo é feito por produtos.item_legado = SAIDASITENS.ITEM.'
    },
    referencias,
    totais: {
      produtos_ativos: itens.length,
      produtos_com_item_legado: itens.filter((item) => item.item_legado).length,
      produtos_sem_item_legado: itens.filter((item) => !item.item_legado).length,
      publicacoes: totalPublicacoes,
      aparicoes: totalAparicoes,
      vendas_mapeadas: numero(totalVendasMapeadas, 3),
      produtos_sem_aparicao: itens.filter((item) => item.aparicoes === 0).length,
      produtos_vendendo_sem_divulgacao: itens.filter((item) => item.classificacao === 'esquecido').length,
      oportunidades: itens.filter((item) => item.classificacao === 'oportunidade').length,
      baixa_resposta: itens.filter((item) => item.classificacao === 'baixa_resposta').length,
      itens_firebird_sem_vinculo: itensVendaSemVinculo.length
    },
    itens_firebird_sem_vinculo: itensVendaSemVinculo.slice(0, 50),
    itens
  };
}

module.exports = {
  carregarTermometro,
  carregarHistoricoProduto
};
