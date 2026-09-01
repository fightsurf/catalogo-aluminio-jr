const DEFAULT_GRAPH_BASE_URL = 'https://graph.facebook.com';
const DEFAULT_API_VERSION = 'v25.0';
// Página oficial Alumínio JR. Pode ser sobrescrita no Render por FACEBOOK_PAGE_ID.
const DEFAULT_PAGE_ID = '654187744727490';
const MAX_FOTOS_CARROSSEL = 10;

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
    // O mesmo System User Token validado para o Instagram pode publicar na Página,
    // desde que o ativo Página esteja atribuído e pages_manage_posts esteja no token.
    accessToken: normalizarValor(
      process.env.FACEBOOK_ACCESS_TOKEN
      || process.env.META_ACCESS_TOKEN
      || process.env.INSTAGRAM_ACCESS_TOKEN
      || ''
    ),
  };
}

function diagnosticarConfiguracao() {
  const config = getConfig();
  const faltando = [];
  if (!config.pageId) faltando.push('FACEBOOK_PAGE_ID');
  if (!config.accessToken) faltando.push('FACEBOOK_ACCESS_TOKEN ou INSTAGRAM_ACCESS_TOKEN');
  return {
    configurado: faltando.length === 0,
    faltando,
    page_id: config.pageId,
    api_version: config.apiVersion,
    graph_base_url: config.baseUrl,
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
  const config = validarConfiguracao(getConfig());
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
  const config = validarConfiguracao(getConfig());
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

async function publicarFeedCarrossel({ imageUrls, message = '' }) {
  const config = validarConfiguracao(getConfig());
  const urls = (Array.isArray(imageUrls) ? imageUrls : [])
    .map(validarImageUrl)
    .filter(Boolean);

  if (!urls.length) throw new Error('Nenhuma imagem foi informada para o carrossel do Facebook.');
  if (urls.length > MAX_FOTOS_CARROSSEL) {
    throw new Error(`O carrossel do Facebook aceita no máximo ${MAX_FOTOS_CARROSSEL} fotos por publicação.`);
  }
  if (urls.length === 1) return publicarFeedImagem({ imageUrl: urls[0], message });

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
  publicarFeedImagem,
  publicarFeedCarrossel,
};
