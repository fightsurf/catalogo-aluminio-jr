const DEFAULT_GRAPH_BASE_URL = 'https://graph.facebook.com';
const DEFAULT_API_VERSION = 'v25.0';
// Página oficial Alumínio JR. Pode ser sobrescrita no Render por FACEBOOK_PAGE_ID.
const DEFAULT_PAGE_ID = '654187744727490';
const MAX_FOTOS_CARROSSEL = 10;

let pageTokenCache = null;

function normalizarValor(valor) {
  let texto = String(valor ?? '').trim();
  if (
    texto.length >= 2
    && ((texto.startsWith('"') && texto.endsWith('"'))
      || (texto.startsWith("'") && texto.endsWith("'")))
  ) {
    texto = texto.slice(1, -1).trim();
  }
  return texto;
}

function normalizarBaseUrl(valor) {
  const base = normalizarValor(valor || DEFAULT_GRAPH_BASE_URL).replace(/\/+$/, '');
  let url;
  try {
    url = new URL(base);
  } catch (_) {
    throw new Error('FACEBOOK_GRAPH_BASE_URL inválida.');
  }
  if (url.protocol !== 'https:') throw new Error('FACEBOOK_GRAPH_BASE_URL deve usar HTTPS.');
  return base;
}

function normalizarVersao(valor) {
  const versao = normalizarValor(valor || DEFAULT_API_VERSION);
  return versao.startsWith('v') ? versao : `v${versao}`;
}

function getConfig() {
  return {
    baseUrl: normalizarBaseUrl(
      process.env.FACEBOOK_GRAPH_BASE_URL
      || process.env.INSTAGRAM_GRAPH_BASE_URL
      || DEFAULT_GRAPH_BASE_URL
    ),
    apiVersion: normalizarVersao(
      process.env.FACEBOOK_GRAPH_API_VERSION
      || process.env.INSTAGRAM_GRAPH_API_VERSION
      || DEFAULT_API_VERSION
    ),
    pageId: normalizarValor(process.env.FACEBOOK_PAGE_ID || DEFAULT_PAGE_ID),

    // Opcional: se houver um Page Access Token explícito, usa diretamente.
    pageAccessToken: normalizarValor(process.env.FACEBOOK_PAGE_ACCESS_TOKEN || ''),

    // Token estável do System User (aluminiojr bot). É usado para obter o
    // Page Access Token; NÃO é usado diretamente para postar na Página.
    sourceAccessToken: normalizarValor(
      process.env.FACEBOOK_SYSTEM_USER_ACCESS_TOKEN
      || process.env.META_ACCESS_TOKEN
      || process.env.INSTAGRAM_ACCESS_TOKEN
      || process.env.FACEBOOK_ACCESS_TOKEN
      || ''
    ),
  };
}

function diagnosticarConfiguracao() {
  const config = getConfig();
  const faltando = [];
  if (!config.pageId) faltando.push('FACEBOOK_PAGE_ID');
  if (!config.pageAccessToken && !config.sourceAccessToken) {
    faltando.push('FACEBOOK_PAGE_ACCESS_TOKEN ou INSTAGRAM_ACCESS_TOKEN');
  }
  return {
    configurado: faltando.length === 0,
    faltando,
    page_id: config.pageId,
    api_version: config.apiVersion,
    graph_base_url: config.baseUrl,
    token_mode: config.pageAccessToken ? 'page_token_direto' : 'page_token_automatico',
  };
}

function validarConfiguracao(config) {
  const diagnostico = diagnosticarConfiguracao();
  if (!diagnostico.configurado) {
    throw new Error(`Facebook não configurado. Configure: ${diagnostico.faltando.join(', ')}.`);
  }
  return config;
}

function mensagemErroMeta(data, texto, status) {
  const erro = data?.error || {};
  const detalhe = erro.message || data?.message || texto || 'Erro não informado pela Meta.';
  const codigo = erro.code ? ` código ${erro.code}` : '';
  const subcodigo = erro.error_subcode ? `/${erro.error_subcode}` : '';
  return `Facebook/Meta respondeu ${status}${codigo}${subcodigo}: ${detalhe}`;
}

async function lerResposta(response) {
  const texto = await response.text().catch(() => '');
  let data = null;
  if (texto) {
    try { data = JSON.parse(texto); } catch (_) { data = { raw: texto }; }
  }
  if (!response.ok || data?.error) throw new Error(mensagemErroMeta(data, texto, response.status));
  return data || {};
}

function montarEndpoint(config, recurso) {
  const parte = String(recurso || '').replace(/^\/+/, '');
  return `${config.baseUrl}/${config.apiVersion}/${parte}`;
}

async function getGraph(config, recurso, accessToken, parametros = {}) {
  const url = new URL(montarEndpoint(config, recurso));
  Object.entries(parametros).forEach(([chave, valor]) => {
    if (valor !== undefined && valor !== null && String(valor) !== '') {
      url.searchParams.set(chave, String(valor));
    }
  });
  url.searchParams.set('access_token', accessToken);

  let response;
  try {
    response = await fetch(url, { method: 'GET' });
  } catch (error) {
    throw new Error(`Falha ao conectar à API do Facebook/Meta: ${error.message}`);
  }
  return lerResposta(response);
}

async function obterPageAccessToken(config) {
  if (config.pageAccessToken) return config.pageAccessToken;

  const chaveCache = `${config.pageId}:${config.sourceAccessToken}`;
  if (pageTokenCache?.chave === chaveCache && pageTokenCache?.token) {
    return pageTokenCache.token;
  }

  let data;
  try {
    data = await getGraph(
      config,
      config.pageId,
      config.sourceAccessToken,
      { fields: 'id,name,access_token' }
    );
  } catch (error) {
    throw new Error(
      `Não foi possível obter o Page Access Token da Página Alumínio JR usando o token do bot. `
      + `${error.message}`
    );
  }

  const pageToken = normalizarValor(data?.access_token || '');
  if (!pageToken) {
    throw new Error(
      'A Meta reconheceu a Página, mas não retornou um Page Access Token. '
      + 'Confirme que o usuário do sistema possui acesso total à Página e as permissões '
      + 'pages_show_list, pages_read_engagement, pages_manage_posts e business_management. '
      + 'Como alternativa, configure FACEBOOK_PAGE_ACCESS_TOKEN no Render.'
    );
  }

  if (data?.id && String(data.id) !== String(config.pageId)) {
    throw new Error(`A Meta retornou uma Página diferente da configurada (${data.id}).`);
  }

  pageTokenCache = { chave: chaveCache, token: pageToken };
  return pageToken;
}

async function prepararConfigPublicacao() {
  const config = validarConfiguracao(getConfig());
  const pageAccessToken = await obterPageAccessToken(config);
  return { ...config, accessToken: pageAccessToken };
}

function adicionarParametro(body, chave, valor) {
  if (valor === undefined || valor === null || String(valor) === '') return;
  if (Array.isArray(valor)) {
    valor.forEach((item, index) => {
      const serializado = typeof item === 'string' ? item : JSON.stringify(item);
      body.set(`${chave}[${index}]`, serializado);
    });
    return;
  }
  body.set(chave, String(valor));
}

async function postGraph(config, recurso, parametros = {}) {
  const body = new URLSearchParams();
  Object.entries(parametros).forEach(([chave, valor]) => adicionarParametro(body, chave, valor));
  body.set('access_token', config.accessToken);

  let response;
  try {
    response = await fetch(montarEndpoint(config, recurso), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
  } catch (error) {
    throw new Error(`Falha ao conectar à API do Facebook/Meta: ${error.message}`);
  }
  return lerResposta(response);
}

function validarVideoUrl(videoUrl) {
  const url = String(videoUrl || '').trim();
  if (!/^https:\/\//i.test(url)) {
    throw new Error('O vídeo do Facebook precisa estar disponível em uma URL pública HTTPS.');
  }
  return url;
}

async function postUploadUrl(uploadUrl, accessToken, videoUrl) {
  let response;
  try {
    response = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        Authorization: `OAuth ${accessToken}`,
        file_url: validarVideoUrl(videoUrl),
      },
    });
  } catch (error) {
    throw new Error(`Falha ao enviar o vídeo para o Facebook: ${error.message}`);
  }
  return lerResposta(response);
}

function validarImageUrl(imageUrl) {
  const url = String(imageUrl || '').trim();
  if (!/^https:\/\//i.test(url)) {
    throw new Error('A imagem do Facebook precisa estar disponível em uma URL pública HTTPS.');
  }
  return url;
}

async function uploadFotoNaoPublicada(config, imageUrl) {
  const data = await postGraph(config, `${config.pageId}/photos`, {
    url: validarImageUrl(imageUrl),
    published: 'false',
  });
  if (!data.id) throw new Error('A Meta não retornou o ID da foto enviada ao Facebook.');
  return String(data.id);
}

async function publicarStoryImagem({ imageUrl }) {
  const config = await prepararConfigPublicacao();
  const photoId = await uploadFotoNaoPublicada(config, imageUrl);
  const data = await postGraph(config, `${config.pageId}/photo_stories`, { photo_id: photoId });
  if (data.success !== true && !data.post_id) {
    throw new Error('A Meta não confirmou a publicação do Story do Facebook.');
  }
  return {
    success: true,
    status: 'publicado',
    photo_id: photoId,
    post_id: data.post_id ? String(data.post_id) : null,
    api_version: config.apiVersion,
    page_id: config.pageId,
  };
}

async function publicarFeedImagem({ imageUrl, message = '' }) {
  const config = await prepararConfigPublicacao();
  const data = await postGraph(config, `${config.pageId}/photos`, {
    url: validarImageUrl(imageUrl),
    caption: String(message || '').trim(),
    published: 'true',
  });
  if (!data.id && !data.post_id) throw new Error('A Meta não retornou o ID da publicação no Facebook.');
  return {
    success: true,
    status: 'publicado',
    photo_id: data.id ? String(data.id) : null,
    post_id: data.post_id ? String(data.post_id) : (data.id ? String(data.id) : null),
    api_version: config.apiVersion,
    page_id: config.pageId,
  };
}

async function publicarStoryVideo({ videoUrl }) {
  const config = await prepararConfigPublicacao();
  const inicio = await postGraph(config, `${config.pageId}/video_stories`, {
    upload_phase: 'start',
  });

  const videoId = String(inicio?.video_id || '').trim();
  const uploadUrl = String(inicio?.upload_url || '').trim();
  if (!videoId || !uploadUrl) {
    throw new Error('A Meta não retornou video_id/upload_url para o Story do Facebook.');
  }

  await postUploadUrl(uploadUrl, config.accessToken, videoUrl);

  const fim = await postGraph(config, `${config.pageId}/video_stories`, {
    upload_phase: 'finish',
    video_id: videoId,
    video_state: 'PUBLISHED',
  });

  if (fim.success !== true && !fim.post_id) {
    throw new Error('A Meta não confirmou a publicação do Story em vídeo no Facebook.');
  }

  return {
    success: true,
    status: 'publicado',
    video_id: videoId,
    post_id: fim.post_id ? String(fim.post_id) : null,
    api_version: config.apiVersion,
    page_id: config.pageId,
  };
}

async function publicarFeedVideo({ videoUrl, message = '', title = '' }) {
  const config = await prepararConfigPublicacao();
  const data = await postGraph(config, `${config.pageId}/videos`, {
    file_url: validarVideoUrl(videoUrl),
    description: String(message || '').trim(),
    title: String(title || '').trim(),
    published: 'true',
  });

  if (!data.id) throw new Error('A Meta não retornou o ID do vídeo publicado no feed do Facebook.');

  return {
    success: true,
    status: 'publicado',
    video_id: String(data.id),
    post_id: data.post_id ? String(data.post_id) : String(data.id),
    api_version: config.apiVersion,
    page_id: config.pageId,
  };
}

async function publicarFeedCarrossel({ imageUrls, message = '' }) {
  const config = await prepararConfigPublicacao();
  const urls = (Array.isArray(imageUrls) ? imageUrls : [])
    .map(validarImageUrl)
    .filter(Boolean);

  if (!urls.length) throw new Error('Nenhuma imagem foi informada para o carrossel do Facebook.');
  if (urls.length > MAX_FOTOS_CARROSSEL) {
    throw new Error(`O carrossel do Facebook aceita no máximo ${MAX_FOTOS_CARROSSEL} fotos por publicação.`);
  }
  if (urls.length === 1) {
    const data = await postGraph(config, `${config.pageId}/photos`, {
      url: urls[0],
      caption: String(message || '').trim(),
      published: 'true',
    });
    if (!data.id && !data.post_id) throw new Error('A Meta não retornou o ID da publicação no Facebook.');
    return {
      success: true,
      status: 'publicado',
      photo_id: data.id ? String(data.id) : null,
      post_id: data.post_id ? String(data.post_id) : (data.id ? String(data.id) : null),
      total_fotos: 1,
      api_version: config.apiVersion,
      page_id: config.pageId,
    };
  }

  const photoIds = [];
  for (const url of urls) photoIds.push(await uploadFotoNaoPublicada(config, url));

  const data = await postGraph(config, `${config.pageId}/feed`, {
    message: String(message || '').trim(),
    attached_media: photoIds.map(id => ({ media_fbid: id })),
  });
  if (!data.id) throw new Error('A Meta não retornou o ID do carrossel publicado no Facebook.');

  return {
    success: true,
    status: 'publicado',
    post_id: String(data.id),
    photo_ids: photoIds,
    total_fotos: photoIds.length,
    api_version: config.apiVersion,
    page_id: config.pageId,
  };
}

module.exports = {
  MAX_FOTOS_CARROSSEL,
  diagnosticarConfiguracao,
  publicarStoryImagem,
  publicarStoryVideo,
  publicarFeedImagem,
  publicarFeedVideo,
  publicarFeedCarrossel,
};
