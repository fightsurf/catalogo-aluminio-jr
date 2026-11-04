'use strict';
// Painel rotativo do Termômetro: 30 dias de dados REAIS do catálogo e do legado.
const pool = require('../../../db/connection');
const bridge = require('../legado/legadoBridge.service');
const schema = require('./termometroSchema.service');
const custoService = require('../produtoResumoCusto/produtoResumoCusto.service');

const ZONA = 'America/Fortaleza';
const FONTES = ['status_zap', 'central_ofertas', 'status_videos'];
const TTL_MS = 60 * 1000;
let cache = null;
let emCurso = null;

function calendario() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date());
  const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
  const hoje = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day));
  return Array.from({ length: 30 }, (_, i) =>
    new Date(hoje - (29 - i) * 86400000).toISOString().slice(0, 10));
}
function dataISO(valor) {
  if (!valor) return '';
  const s = String(valor);
  if (/^\d{4}-\d\d-\d\d/.test(s)) return s.slice(0, 10);
  if (/^\d\d\/\d\d\/\d{4}$/.test(s)) {
    return s.slice(6) + '-' + s.slice(3, 5) + '-' + s.slice(0, 2);
  }
  const d = new Date(valor);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}
function decimal(valor) {
  const numero = Number(valor || 0);
  return Number.isFinite(numero) ? Number(numero.toFixed(3)) : 0;
}
function cancelado(pedido) {
  const situacao = String(pedido.situacao || pedido.SITUACAO ||
    pedido.statusPedido || pedido.STATUS_PEDIDO || '').trim().toUpperCase();
  return pedido.cancelado === true || pedido.CANCELADO === true ||
    ['C', 'CANCELADO', 'CANCELADA'].includes(situacao);
}
function listaCarradas(response) {
  const dados = response && (response.dados || response.data || response);
  return Array.isArray(dados) ? dados :
    (Array.isArray(dados?.carradas) ? dados.carradas : []);
}
async function listarCarradasNoPeriodo(datas) {
  const inicio = datas[0];
  const fim = datas[datas.length - 1];
  let carradas = [];
  try {
    const resposta = await bridge.get('/api/carradas/resumo-producao-lista');
    carradas = listaCarradas(resposta);
  } catch (error) {
    console.warn('Termômetro: falha no resumo de carradas; tentando lista completa:', error.message);
  }
  // Sem limite de dias: a API otimizada lista todas as carradas;
  // o filtro local seleciona exatamente os últimos 30 dias.
  if (!carradas.length) {
    carradas = listaCarradas(await bridge.get('/api/carradas'));
  }
  return carradas.filter(c => {
    const data = dataISO(c.data);
    return data >= inicio && data <= fim;
  });
}
async function mapearLimitado(lista, limite, fn) {
  const out = new Array(lista.length);
  let proximo = 0;
  await Promise.all(Array.from({ length: Math.min(limite, lista.length) }, async () => {
    while (proximo < lista.length) {
      const i = proximo++;
      out[i] = await fn(lista[i]);
    }
  }));
  return out;
}
async function carregarVendas(datas) {
  const carradas = await listarCarradasNoPeriodo(datas);
  const detalhadas = await mapearLimitado(carradas, 4, async carrada => {
    const pedidos = carrada.pedidos;
    if (Array.isArray(pedidos) && pedidos.every(p => Array.isArray(p.itens))) {
      return carrada;
    }
    const resposta = await bridge.get('/api/carradas/' + encodeURIComponent(carrada.codigo));
    const detalhe = resposta.dado || resposta.dados || resposta.data;
    if (!detalhe || !Array.isArray(detalhe.pedidos)) {
      throw new Error('Carrada ' + carrada.codigo + ' sem itens de pedidos no legado.');
    }
    return { ...carrada, ...detalhe };
  });
  const vendas = new Map();
  // A mesma convenção do painel anterior: data da carrada, não data de faturamento.
  for (const carrada of detalhadas) {
    const data = dataISO(carrada.data);
    for (const pedido of carrada.pedidos || []) {
      if (cancelado(pedido)) continue;
      for (const item of pedido.itens || []) {
        const codigo = Number(item.item ?? item.ITEM);
        const quantidade = decimal(item.quantidade ?? item.QUANTIDADE);
        if (!Number.isSafeInteger(codigo) || codigo <= 0 || quantidade <= 0) continue;
        const chave = codigo + ':' + data;
        vendas.set(chave, decimal((vendas.get(chave) || 0) + quantidade));
      }
    }
  }
  return vendas;
}
async function montar() {
  await schema.criarEstrutura();
  const datas = calendario();
  const inicio = datas[0] + 'T00:00:00-03:00';
  const ultimo = new Date(Date.parse(datas[datas.length - 1] + 'T00:00:00Z') + 86400000)
    .toISOString().slice(0, 10) + 'T00:00:00-03:00';
  const [produtosResult, divulgacoesResult, vendas, custosResult] = await Promise.all([
    pool.query('SELECT id, nome, foto, preco, item_legado, ativo FROM produtos ORDER BY nome ASC, id ASC'),
    pool.query(
      'SELECT produto_id, TO_CHAR(publicado_em AT TIME ZONE \'America/Fortaleza\', \'YYYY-MM-DD\') AS dia, COUNT(*)::int AS total ' +
      'FROM termometro_aparicoes WHERE origem = ANY($1::text[]) AND publicado_em >= $2::timestamptz ' +
      'AND publicado_em < $3::timestamptz GROUP BY 1, 2',
      [FONTES, inicio, ultimo]
    ),
    carregarVendas(datas),
    custoService.listar({ ativos: false })
  ]);
  const div = new Map(divulgacoesResult.rows.map(row => [
    Number(row.produto_id) + ':' + row.dia, Number(row.total || 0)
  ]));
  const custos = new Map();
  for (const c of custosResult.produtos || []) {
    // Não inventar custo: composição ausente/zerada aparece como indisponível.
    if (!custos.has(Number(c.produto_id)) || (custos.get(Number(c.produto_id)) === null && !c.sem_composicao)) {
      custos.set(Number(c.produto_id),
        c.sem_composicao || c.custo_zerado ? null : decimal(c.custo));
    }
  }
  return {
    periodo: { inicio: datas[0], fim: datas[datas.length - 1], datas },
    intervalo_segundos: 300,
    fonte_vendas: 'Pedidos não cancelados do legado, agrupados pela data da carrada',
    fonte_divulgacoes: 'Publicações registradas em Status WhatsApp, Central de Ofertas e Status Vídeos',
    atualizado_em: new Date().toISOString(),
    itens: produtosResult.rows.map(p => {
      const codigo = Number(p.item_legado) || null;
      return {
        id: Number(p.id), nome: p.nome, foto: p.foto || null,
        ativo: Boolean(p.ativo), item_legado: codigo,
        preco: p.preco === null ? null : Number(p.preco),
        custo: custos.has(Number(p.id)) ? custos.get(Number(p.id)) : null,
        dias: datas.map(data => ({
          data,
          divulgado: div.get(p.id + ':' + data) || 0,
          vendido: codigo ? (vendas.get(codigo + ':' + data) || 0) : null
        }))
      };
    })
  };
}
async function carregar() {
  const agora = Date.now();
  const diaAtual = calendario()[29];
  if (cache && agora - cache.criado < TTL_MS && cache.data.periodo.fim === diaAtual) return cache.data;
  if (!emCurso) {
    emCurso = montar().then(data => {
      cache = { criado: Date.now(), data };
      return data;
    }).finally(() => { emCurso = null; });
  }
  return emCurso;
}
module.exports = { carregar };
