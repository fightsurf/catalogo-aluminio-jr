const pool = require('../../../db/connection');
const produtoFotosSchemaService = require('../produto/produtoFotosSchema.service');
const zapiService = require('../integracoes/zapi.service');
const instagramService = require('../integracoes/instagram.service');
const facebookService = require('../integracoes/facebook.service');
const cloudflareR2Service = require('../cloudflare/cloudflareR2.service');
const sharp = require('sharp');

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
    throw new Error('Identificador do envio não informado.');
  }

  if (requestId.length > 120 || !/^[a-zA-Z0-9._:-]+$/.test(requestId)) {
    throw new Error('Identificador do envio inválido.');
  }

  return requestId;
}

function normalizarTelefoneDestino(valor) {
  const telefone = zapiService.normalizarTelefone(valor);

  if (!telefone) {
    throw new Error('Número do WhatsApp não informado.');
  }

  if (telefone.length < 10) {
    throw new Error('Número do WhatsApp inválido. Informe com DDI e DDD.');
  }

  return telefone;
}

function formatarPreco(valor) {
  const numero = Number(valor);

  if (!Number.isFinite(numero) || numero <= 0) {
    throw new Error('Produto sem preço válido para envio.');
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

function formatarLegendaProduto(nome, preco) {
  const descricao = limparTexto(nome);

  if (!descricao) {
    throw new Error('Produto sem descrição válida para envio.');
  }

  return `${descricao}\n${formatarPreco(preco)}`;
}

function avaliarProduto(produto) {
  const foto1 = limparTexto(produto.foto);
  const descricao = limparTexto(produto.nome);
  const precoNumero = Number(produto.preco);
  let motivo = '';

  if (!foto1) {
    motivo = 'Produto sem foto 1.';
  } else if (!descricao) {
    motivo = 'Produto sem descrição válida.';
  } else if (!Number.isFinite(precoNumero) || precoNumero <= 0) {
    motivo = 'Produto sem preço válido.';
  }

  return {
    id: Number(produto.id),
    nome: descricao,
    preco: Number.isFinite(precoNumero) ? precoNumero : null,
    preco_formatado: Number.isFinite(precoNumero) && precoNumero > 0
      ? formatarPreco(precoNumero)
      : '',
    legenda: !motivo ? formatarLegendaProduto(descricao, precoNumero) : '',
    foto: foto1,
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
          AND NULLIF(BTRIM(p.foto), '') IS NOT NULL
          AND NULLIF(BTRIM(p.nome), '') IS NOT NULL
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
      p.foto,
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

async function buscarProdutoParaEnvio(produtoId, categoriaId) {
  await produtoFotosSchemaService.criarEstrutura();

  const result = await pool.query(`
    SELECT
      p.id,
      p.nome,
      p.preco,
      p.foto,
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

async function enviarProduto({ requestId, produtoId, categoriaId, telefone }) {
  const idRequisicao = normalizarRequestId(requestId);
  const idProduto = normalizarId(produtoId, 'Produto');
  const idCategoria = normalizarId(categoriaId, 'Categoria');
  const telefoneDestino = normalizarTelefoneDestino(telefone);
  const chaveRequisicao = `${idRequisicao}:${telefoneDestino}`;

  const requisicaoExistente = requisicoesEmAndamento.get(chaveRequisicao);
  if (requisicaoExistente) {
    const resultadoExistente = await requisicaoExistente;
    return {
      ...resultadoExistente,
      repetida: true,
    };
  }

  const promessa = (async () => {
    // A conferência é feita novamente no servidor no momento exato do envio.
    const produto = await buscarProdutoParaEnvio(idProduto, idCategoria);
    const legenda = formatarLegendaProduto(produto.nome, produto.preco);

    const resultado = await zapiService.enviarImagem({
      telefone: telefoneDestino,
      imagem: produto.foto,
      legenda,
    });

    return {
      success: true,
      requestId: idRequisicao,
      telefone: telefoneDestino,
      produto: {
        id: produto.id,
        nome: produto.nome,
        categoria_id: produto.categoria_id,
        categoria: produto.categoria,
        preco: produto.preco,
        preco_formatado: legenda,
        foto: produto.foto,
      },
      legenda,
      zapi: resultado.zapi,
      repetida: false,
    };
  })();

  requisicoesEmAndamento.set(chaveRequisicao, promessa);

  try {
    const resultado = await promessa;
    removerDoCacheDepois(chaveRequisicao);
    return resultado;
  } catch (error) {
    requisicoesEmAndamento.delete(chaveRequisicao);
    throw error;
  }
}


function limitarErroPublicacao(error) {
  return String(error?.message || error || 'Erro não informado.').trim().slice(0, 2000);
}

function escaparSvg(valor) {
  return String(valor ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function quebrarTexto(valor, maximo = 28, maxLinhas = 3) {
  const palavras = limparTexto(valor).split(/\s+/).filter(Boolean);
  const linhas = [];
  let atual = '';

  for (const palavra of palavras) {
    const candidata = atual ? `${atual} ${palavra}` : palavra;
    if (candidata.length <= maximo || !atual) {
      atual = candidata;
      continue;
    }

    linhas.push(atual);
    atual = palavra;
    if (linhas.length >= maxLinhas - 1) break;
  }

  if (atual && linhas.length < maxLinhas) linhas.push(atual);

  const consumido = linhas.join(' ').length;
  if (linhas.length === maxLinhas && consumido < limparTexto(valor).length) {
    linhas[maxLinhas - 1] = `${linhas[maxLinhas - 1].replace(/[.…]+$/, '').slice(0, Math.max(1, maximo - 1)).trim()}…`;
  }

  return linhas;
}

async function baixarImagemPublica(urlInformada) {
  const url = limparTexto(urlInformada);
  if (!/^https:\/\//i.test(url)) {
    throw new Error('A foto do produto precisa estar disponível em uma URL pública HTTPS para o Instagram.');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  if (typeof timer.unref === 'function') timer.unref();

  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: { Accept: 'image/*' },
    });

    if (!response.ok) {
      throw new Error(`Não foi possível baixar a foto do produto para o Instagram (HTTP ${response.status}).`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    if (!buffer.length) throw new Error('A foto do produto retornou vazia.');
    return buffer;
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error('Tempo excedido ao baixar a foto do produto para o Instagram.');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function gerarArteStoryInstagram(produto) {
  const fotoBuffer = await baixarImagemPublica(produto.foto);
  const largura = 1080;
  const altura = 1920;
  const margem = 64;
  const topoImagem = 70;
  const alturaImagem = 1370;
  const larguraImagem = largura - (margem * 2);

  const fotoTratada = await sharp(fotoBuffer, { animated: false })
    .rotate()
    .resize({
      width: larguraImagem,
      height: alturaImagem,
      fit: 'contain',
      background: { r: 255, g: 255, b: 255, alpha: 1 },
      withoutEnlargement: false,
    })
    .jpeg({ quality: 92, mozjpeg: true })
    .toBuffer();

  const linhasNome = quebrarTexto(produto.nome, 30, 3);
  const inicioNome = 1510;
  const espacamento = 62;
  const nomeSvg = linhasNome.map((linha, index) => (
    `<text x="540" y="${inicioNome + (index * espacamento)}" text-anchor="middle" `
      + 'font-family="Arial, Helvetica, sans-serif" font-size="48" font-weight="700" fill="#111827">'
      + `${escaparSvg(linha)}</text>`
  )).join('');
  const yPreco = inicioNome + (linhasNome.length * espacamento) + 72;

  const overlay = Buffer.from(`
    <svg width="${largura}" height="${altura}" xmlns="http://www.w3.org/2000/svg">
      <rect width="1080" height="1920" fill="#ffffff"/>
      <rect x="44" y="44" width="992" height="1418" rx="34" fill="#ffffff" stroke="#e5e7eb" stroke-width="3"/>
      ${nomeSvg}
      <text x="540" y="${yPreco}" text-anchor="middle"
        font-family="Arial, Helvetica, sans-serif" font-size="88" font-weight="800" fill="#111827">${escaparSvg(produto.preco_formatado)}</text>
      <text x="540" y="1860" text-anchor="middle"
        font-family="Arial, Helvetica, sans-serif" font-size="30" font-weight="700" letter-spacing="2" fill="#6b7280">ALUMÍNIO JR</text>
    </svg>
  `);

  return sharp({
    create: {
      width: largura,
      height: altura,
      channels: 3,
      background: '#ffffff',
    },
  })
    .composite([
      { input: overlay, left: 0, top: 0 },
      { input: fotoTratada, left: margem, top: topoImagem },
    ])
    .jpeg({ quality: 92, mozjpeg: true })
    .toBuffer();
}

async function publicarProdutoInstagram(produto, requestId) {
  const diagnostico = instagramService.diagnosticarConfiguracao();
  if (!diagnostico.configurado) {
    throw new Error(`Instagram não configurado. Configure: ${diagnostico.faltando.join(', ')}.`);
  }

  let temporario = null;
  try {
    const buffer = await gerarArteStoryInstagram(produto);
    temporario = await cloudflareR2Service.uploadBuffer(buffer, {
      // O prefixo ofertas/ já possui exclusão unitária protegida no serviço R2.
      // O arquivo existe apenas enquanto a Meta processa o Story.
      pasta: 'ofertas',
      nome: `status-instagram-produto-${produto.id}-${requestId}.jpg`,
      contentType: 'image/jpeg',
      metadata: {
        produto_id: produto.id,
        destino: 'status-instagram',
      },
    });

    return await instagramService.publicarStoryImagem({ imageUrl: temporario.url });
  } finally {
    if (temporario?.key) {
      try {
        await cloudflareR2Service.excluirObjeto(temporario.key);
      } catch (error) {
        console.error('[Status WhatsApp/Instagram] Falha ao excluir imagem temporária do R2:', limitarErroPublicacao(error));
      }
    }
  }
}


async function gerarArteFeedFacebook(produto) {
  const fotoBuffer = await baixarImagemPublica(produto.foto);
  const largura = 1080;
  const altura = 1350;
  const margem = 58;
  const topoImagem = 56;
  const larguraImagem = largura - (margem * 2);
  const alturaImagem = 900;

  const fotoTratada = await sharp(fotoBuffer, { animated: false })
    .rotate()
    .resize({
      width: larguraImagem,
      height: alturaImagem,
      fit: 'contain',
      background: { r: 255, g: 255, b: 255, alpha: 1 },
      withoutEnlargement: false,
    })
    .jpeg({ quality: 92, mozjpeg: true })
    .toBuffer();

  const linhasNome = quebrarTexto(produto.nome, 31, 3);
  const inicioNome = 1010;
  const espacamento = 52;
  const nomeSvg = linhasNome.map((linha, index) => (
    `<text x="540" y="${inicioNome + (index * espacamento)}" text-anchor="middle" `
      + 'font-family="Arial, Helvetica, sans-serif" font-size="42" font-weight="700" fill="#111827">'
      + `${escaparSvg(linha)}</text>`
  )).join('');
  const yPreco = inicioNome + (linhasNome.length * espacamento) + 62;

  const overlay = Buffer.from(`
    <svg width="${largura}" height="${altura}" xmlns="http://www.w3.org/2000/svg">
      <rect width="1080" height="1350" fill="#ffffff"/>
      <rect x="36" y="36" width="1008" height="930" rx="28" fill="#ffffff" stroke="#e5e7eb" stroke-width="3"/>
      ${nomeSvg}
      <text x="540" y="${yPreco}" text-anchor="middle"
        font-family="Arial, Helvetica, sans-serif" font-size="72" font-weight="800" fill="#111827">${escaparSvg(produto.preco_formatado)}</text>
      <text x="540" y="1310" text-anchor="middle"
        font-family="Arial, Helvetica, sans-serif" font-size="26" font-weight="700" letter-spacing="2" fill="#6b7280">ALUMÍNIO JR</text>
    </svg>
  `);

  return sharp({
    create: {
      width: largura,
      height: altura,
      channels: 3,
      background: '#ffffff',
    },
  })
    .composite([
      { input: overlay, left: 0, top: 0 },
      { input: fotoTratada, left: margem, top: topoImagem },
    ])
    .jpeg({ quality: 92, mozjpeg: true })
    .toBuffer();
}

async function publicarProdutoFacebookStory(produto, requestId) {
  const diagnostico = facebookService.diagnosticarConfiguracao();
  if (!diagnostico.configurado) {
    throw new Error(`Facebook não configurado. Configure: ${diagnostico.faltando.join(', ')}.`);
  }

  let temporario = null;
  try {
    const buffer = await gerarArteStoryInstagram(produto);
    temporario = await cloudflareR2Service.uploadBuffer(buffer, {
      pasta: 'ofertas',
      nome: `status-facebook-story-produto-${produto.id}-${requestId}.jpg`,
      contentType: 'image/jpeg',
      metadata: {
        produto_id: produto.id,
        destino: 'status-facebook-story',
      },
    });
    return await facebookService.publicarStoryImagem({ imageUrl: temporario.url });
  } finally {
    if (temporario?.key) {
      try {
        await cloudflareR2Service.excluirObjeto(temporario.key);
      } catch (error) {
        console.error('[Status/Facebook] Falha ao excluir imagem temporária do Story:', limitarErroPublicacao(error));
      }
    }
  }
}

function montarTextoCategoriaFacebook(categoria, produtos, indiceGrupo, totalGrupos) {
  const cabecalhoGrupo = totalGrupos > 1 ? ` — ${indiceGrupo + 1}/${totalGrupos}` : '';
  return [
    `OFERTAS — ${categoria.nome}${cabecalhoGrupo}`,
    '',
    ...produtos.map(produto => `• ${produto.nome} — ${produto.preco_formatado}`),
    '',
    'Alumínio JR',
  ].join('\n');
}

async function publicarGrupoCategoriaFacebook(categoria, produtos, indiceGrupo, totalGrupos, requestId) {
  const temporarios = [];
  try {
    for (const produto of produtos) {
      const buffer = await gerarArteFeedFacebook(produto);
      const temporario = await cloudflareR2Service.uploadBuffer(buffer, {
        pasta: 'ofertas',
        nome: `facebook-carrossel-${categoria.id}-${produto.id}-${requestId}.jpg`,
        contentType: 'image/jpeg',
        metadata: {
          categoria_id: categoria.id,
          produto_id: produto.id,
          destino: 'facebook-feed-carrossel',
        },
      });
      temporarios.push(temporario);
    }

    const mensagem = montarTextoCategoriaFacebook(categoria, produtos, indiceGrupo, totalGrupos);
    const resultado = await facebookService.publicarFeedCarrossel({
      imageUrls: temporarios.map(item => item.url),
      message: mensagem,
    });
    return { ...resultado, mensagem, produtos: produtos.map(p => p.id) };
  } finally {
    for (const temporario of temporarios) {
      try {
        await cloudflareR2Service.excluirObjeto(temporario.key);
      } catch (error) {
        console.error('[Status/Facebook] Falha ao excluir imagem temporária do carrossel:', limitarErroPublicacao(error));
      }
    }
  }
}

async function publicarCategoriaFacebook({ requestId, categoriaId }) {
  const idRequisicao = normalizarRequestId(requestId);
  const idCategoria = normalizarId(categoriaId, 'Categoria');
  const chave = `${idRequisicao}:facebook-feed-categoria:${idCategoria}`;

  return executarCanalIdempotente(chave, async () => {
    const diagnostico = facebookService.diagnosticarConfiguracao();
    if (!diagnostico.configurado) {
      throw new Error(`Facebook não configurado. Configure: ${diagnostico.faltando.join(', ')}.`);
    }

    const dados = await listarProdutosPorCategoria(idCategoria);
    const publicaveis = dados.produtos.filter(produto => produto.publicavel);
    if (!publicaveis.length) throw new Error('A categoria não possui produtos publicáveis no Facebook.');

    const limite = facebookService.MAX_FOTOS_CARROSSEL || 10;
    const grupos = [];
    for (let i = 0; i < publicaveis.length; i += limite) grupos.push(publicaveis.slice(i, i + limite));

    const posts = [];
    for (let i = 0; i < grupos.length; i += 1) {
      posts.push(await publicarGrupoCategoriaFacebook(
        dados.categoria,
        grupos[i],
        i,
        grupos.length,
        idRequisicao
      ));
    }

    return {
      success: true,
      status: 'publicado',
      categoria: dados.categoria,
      total_produtos: publicaveis.length,
      total_posts: posts.length,
      posts,
    };
  });
}

async function executarCanalIdempotente(chave, executar) {
  const existente = requisicoesEmAndamento.get(chave);
  if (existente) {
    const resultado = await existente;
    return { ...resultado, repetida: true };
  }

  const promessa = Promise.resolve().then(executar);
  requisicoesEmAndamento.set(chave, promessa);

  try {
    const resultado = await promessa;
    removerDoCacheDepois(chave);
    return { ...resultado, repetida: false };
  } catch (error) {
    // Falha não fica em cache: o botão "Reenviar falhas" pode tentar somente este canal novamente.
    requisicoesEmAndamento.delete(chave);
    throw error;
  }
}

function resultadoCanal(settled, canal) {
  if (settled.status === 'fulfilled') {
    return {
      canal,
      status: 'publicado',
      ...settled.value,
    };
  }

  return {
    canal,
    status: 'erro',
    erro: limitarErroPublicacao(settled.reason),
    repetida: false,
  };
}

async function publicarProdutoNoStatus({ requestId, produtoId, categoriaId }) {
  const idRequisicao = normalizarRequestId(requestId);
  const idProduto = normalizarId(produtoId, 'Produto');
  const idCategoria = normalizarId(categoriaId, 'Categoria');

  const produto = await buscarProdutoParaEnvio(idProduto, idCategoria);
  const legenda = formatarLegendaProduto(produto.nome, produto.preco);

  // Cada Story/canal possui idempotência independente. Reenviar uma falha não
  // duplica os canais que já deram certo enquanto a chave estiver no cache.
  const [whatsappSettled, instagramSettled, facebookStorySettled] = await Promise.allSettled([
    executarCanalIdempotente(`${idRequisicao}:status:whatsapp`, async () => {
      const resultado = await zapiService.enviarImagemStatus({
        imagem: produto.foto,
        legenda,
      });
      return { zapi: resultado.zapi };
    }),
    executarCanalIdempotente(`${idRequisicao}:status:instagram`, async () => {
      const resultado = await publicarProdutoInstagram(produto, idRequisicao);
      return {
        media_id: resultado.media_id,
        container_id: resultado.container_id,
        processamento_status: resultado.processamento_status,
        api_version: resultado.api_version,
      };
    }),
    executarCanalIdempotente(`${idRequisicao}:status:facebook-story`, async () => {
      const resultado = await publicarProdutoFacebookStory(produto, idRequisicao);
      return {
        post_id: resultado.post_id,
        photo_id: resultado.photo_id,
        api_version: resultado.api_version,
      };
    }),
  ]);

  const whatsapp = resultadoCanal(whatsappSettled, 'whatsapp');
  const instagram = resultadoCanal(instagramSettled, 'instagram');
  const facebookStory = resultadoCanal(facebookStorySettled, 'facebook_story');
  const canaisLista = [whatsapp, instagram, facebookStory];
  const publicados = canaisLista.filter(canal => canal.status === 'publicado').length;
  const statusGeral = publicados === canaisLista.length
    ? 'publicado'
    : (publicados > 0 ? 'parcial' : 'erro');

  return {
    success: statusGeral === 'publicado',
    requestId: idRequisicao,
    destino: 'status',
    status_geral: statusGeral,
    produto: {
      id: produto.id,
      nome: produto.nome,
      categoria_id: produto.categoria_id,
      categoria: produto.categoria,
      preco: produto.preco,
      preco_formatado: produto.preco_formatado,
      foto: produto.foto,
    },
    legenda,
    canais: { whatsapp, instagram, facebook_story: facebookStory },
    zapi: whatsapp.zapi || null,
    repetida: Boolean(whatsapp.repetida && instagram.repetida && facebookStory.repetida),
  };
}

module.exports = {
  verificarConexao,
  listarCategorias,
  listarProdutosPorCategoria,
  enviarProduto,
  publicarProdutoNoStatus,
  publicarCategoriaFacebook,
};
