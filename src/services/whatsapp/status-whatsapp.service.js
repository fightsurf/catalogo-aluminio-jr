const pool = require('../../../db/connection');
const produtoFotosSchemaService = require('../produto/produtoFotosSchema.service');
const zapiService = require('../integracoes/zapi.service');

const requisicoesEmAndamento = new Map();
const TEMPO_CACHE_MS = 30 * 60 * 1000;

function limparTexto(valor) {
  return String(valor || '').trim();
}

function normalizarId(valor, campo) {
  const numero = Number.parseInt(valor, 10);

  if (!Number.isInteger(numero) || numero <= 0) {
    throw new Error(`${campo} inválido.`);
  }

  return numero;
}

function normalizarRequestId(valor) {
  const requestId = limparTexto(valor);

  if (!requestId) {
    throw new Error('Identificador da publicação não informado.');
  }

  if (requestId.length > 120 || !/^[a-zA-Z0-9._:-]+$/.test(requestId)) {
    throw new Error('Identificador da publicação inválido.');
  }

  return requestId;
}

function formatarPreco(valor) {
  const numero = Number(valor);

  if (!Number.isFinite(numero) || numero <= 0) {
    throw new Error('Produto sem preço válido para publicação.');
  }

  return numero
    .toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
    .replace(/\u00a0/g, ' ');
}

function avaliarProduto(produto) {
  const foto3 = limparTexto(produto.foto_3);
  const precoNumero = Number(produto.preco);
  let motivo = '';

  if (!foto3) {
    motivo = 'Produto sem foto 3.';
  } else if (!Number.isFinite(precoNumero) || precoNumero <= 0) {
    motivo = 'Produto sem preço válido.';
  }

  return {
    id: Number(produto.id),
    nome: produto.nome,
    preco: Number.isFinite(precoNumero) ? precoNumero : null,
    preco_formatado: Number.isFinite(precoNumero) && precoNumero > 0
      ? formatarPreco(precoNumero)
      : '',
    foto_3: foto3,
    categoria_id: Number(produto.categoria_id),
    categoria: produto.categoria,
    ativo: Boolean(produto.ativo),
    publicavel: !motivo,
    motivo,
  };
}

function removerDoCacheDepois(requestId) {
  const timer = setTimeout(() => {
    requisicoesEmAndamento.delete(requestId);
  }, TEMPO_CACHE_MS);

  if (typeof timer.unref === 'function') {
    timer.unref();
  }
}

async function verificarConexao() {
  const resultado = await zapiService.verificarConexao();

  return {
    connected: Boolean(resultado.connected),
    smartphoneConnected: Boolean(resultado.smartphoneConnected),
    error: resultado.error || '',
  };
}

async function listarCategorias() {
  await produtoFotosSchemaService.criarEstrutura();

  const result = await pool.query(`
    SELECT
      c.id,
      c.nome,
      COUNT(p.id) FILTER (WHERE p.ativo = true)::int AS total_ativos,
      COUNT(p.id) FILTER (
        WHERE p.ativo = true
          AND NULLIF(BTRIM(p.foto_3), '') IS NOT NULL
          AND p.preco IS NOT NULL
          AND p.preco > 0
      )::int AS total_publicaveis
    FROM produtos_categorias c
    LEFT JOIN produtos p ON p.categoria_id = c.id
    GROUP BY c.id, c.nome
    ORDER BY c.nome ASC
  `);

  return result.rows.map((categoria) => ({
    id: Number(categoria.id),
    nome: categoria.nome,
    total_ativos: Number(categoria.total_ativos || 0),
    total_publicaveis: Number(categoria.total_publicaveis || 0),
  }));
}

async function listarProdutosPorCategoria(categoriaId) {
  await produtoFotosSchemaService.criarEstrutura();
  const idCategoria = normalizarId(categoriaId, 'Categoria');

  const categoriaResult = await pool.query(
    'SELECT id, nome FROM produtos_categorias WHERE id = $1',
    [idCategoria]
  );

  if (categoriaResult.rows.length === 0) {
    throw new Error('Categoria não encontrada.');
  }

  const produtosResult = await pool.query(`
    SELECT
      p.id,
      p.nome,
      p.preco,
      p.foto_3,
      p.ativo,
      c.id AS categoria_id,
      c.nome AS categoria
    FROM produtos p
    INNER JOIN produtos_categorias c ON c.id = p.categoria_id
    WHERE p.categoria_id = $1
      AND p.ativo = true
    ORDER BY p.nome ASC
  `, [idCategoria]);

  const produtos = produtosResult.rows.map(avaliarProduto);

  return {
    categoria: {
      id: Number(categoriaResult.rows[0].id),
      nome: categoriaResult.rows[0].nome,
    },
    produtos,
    totais: {
      ativos: produtos.length,
      publicaveis: produtos.filter((produto) => produto.publicavel).length,
      ignorados: produtos.filter((produto) => !produto.publicavel).length,
    },
  };
}

async function buscarProdutoParaPublicacao(produtoId, categoriaId) {
  await produtoFotosSchemaService.criarEstrutura();

  const result = await pool.query(`
    SELECT
      p.id,
      p.nome,
      p.preco,
      p.foto_3,
      p.ativo,
      c.id AS categoria_id,
      c.nome AS categoria
    FROM produtos p
    INNER JOIN produtos_categorias c ON c.id = p.categoria_id
    WHERE p.id = $1
      AND p.categoria_id = $2
    LIMIT 1
  `, [produtoId, categoriaId]);

  if (result.rows.length === 0) {
    throw new Error('Produto não encontrado na categoria selecionada.');
  }

  const produto = avaliarProduto(result.rows[0]);

  if (!produto.ativo) {
    throw new Error('Produto inativo.');
  }

  if (!produto.publicavel) {
    throw new Error(produto.motivo);
  }

  return produto;
}

async function publicarProduto({ requestId, produtoId, categoriaId }) {
  const idRequisicao = normalizarRequestId(requestId);
  const idProduto = normalizarId(produtoId, 'Produto');
  const idCategoria = normalizarId(categoriaId, 'Categoria');

  const requisicaoExistente = requisicoesEmAndamento.get(idRequisicao);
  if (requisicaoExistente) {
    const resultadoExistente = await requisicaoExistente;
    return {
      ...resultadoExistente,
      repetida: true,
    };
  }

  const promessa = (async () => {
    // A conferência é feita novamente no servidor no momento exato do envio.
    const produto = await buscarProdutoParaPublicacao(idProduto, idCategoria);
    const legenda = formatarPreco(produto.preco);

    const resultado = await zapiService.enviarImagemStatus({
      imagem: produto.foto_3,
      legenda,
    });

    return {
      success: true,
      requestId: idRequisicao,
      produto: {
        id: produto.id,
        nome: produto.nome,
        categoria_id: produto.categoria_id,
        categoria: produto.categoria,
        preco: produto.preco,
        preco_formatado: legenda,
        foto_3: produto.foto_3,
      },
      legenda,
      zapi: resultado.zapi,
      repetida: false,
    };
  })();

  requisicoesEmAndamento.set(idRequisicao, promessa);

  try {
    const resultado = await promessa;
    removerDoCacheDepois(idRequisicao);
    return resultado;
  } catch (error) {
    requisicoesEmAndamento.delete(idRequisicao);
    throw error;
  }
}

module.exports = {
  verificarConexao,
  listarCategorias,
  listarProdutosPorCategoria,
  publicarProduto,
};
