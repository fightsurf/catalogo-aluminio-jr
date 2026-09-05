const DEFAULT_GRAPH_BASE_URL = 'https://graph.facebook.com';
const DEFAULT_API_VERSION = 'v25.0';
const DEFAULT_POLL_INTERVAL_MS = 1500;
const DEFAULT_POLL_ATTEMPTS = 16;

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
    throw new Error('INSTAGRAM_GRAPH_BASE_URL inválida.');
  }

  if (url.protocol !== 'https:') {
    throw new Error('INSTAGRAM_GRAPH_BASE_URL deve usar HTTPS.');
  }

  return base;
}

function normalizarVersao(valor) {
  const versao = normalizarValor(valor || DEFAULT_API_VERSION);
  return versao.startsWith('v') ? versao : `v${versao}`;
}

function inteiroPositivo(valor, padrao) {
  const numero = Number.parseInt(String(valor ?? ''), 10);
  return Number.isInteger(numero) && numero > 0 ? numero : padrao;
}

function getConfig() {
  return {
    baseUrl: normalizarBaseUrl(process.env.INSTAGRAM_GRAPH_BASE_URL || DEFAULT_GRAPH_BASE_URL),
    apiVersion: normalizarVersao(process.env.INSTAGRAM_GRAPH_API_VERSION || DEFAULT_API_VERSION),
    igUserId: normalizarValor(process.env.INSTAGRAM_IG_USER_ID || ''),
    accessToken: normalizarValor(process.env.INSTAGRAM_ACCESS_TOKEN || ''),
    pollIntervalMs: inteiroPositivo(process.env.INSTAGRAM_CONTAINER_POLL_INTERVAL_MS, DEFAULT_POLL_INTERVAL_MS),
    pollAttempts: inteiroPositivo(process.env.INSTAGRAM_CONTAINER_POLL_ATTEMPTS, DEFAULT_POLL_ATTEMPTS),
  };
}

function diagnosticarConfiguracao() {
  const config = getConfig();
  const faltando = [];

  if (!config.igUserId) faltando.push('INSTAGRAM_IG_USER_ID');
  if (!config.accessToken) faltando.push('INSTAGRAM_ACCESS_TOKEN');

  return {
    configurado: faltando.length === 0,
    faltando,
    api_version: config.apiVersion,
    graph_base_url: config.baseUrl,
  };
}

function validarConfiguracao(config) {
  const diagnostico = diagnosticarConfiguracao();
  if (!diagnostico.configurado) {
    throw new Error(`Instagram não configurado. Configure: ${diagnostico.faltando.join(', ')}.`);
  }
  return config;
}

function mensagemErroMeta(data, texto, status) {
  const erro = data?.error || {};
  const detalhe = erro.message || data?.message || texto || 'Erro não informado pela Meta.';
  const codigo = erro.code ? ` código ${erro.code}` : '';
  const subcodigo = erro.error_subcode ? `/${erro.error_subcode}` : '';
  return `Instagram/Meta respondeu ${status}${codigo}${subcodigo}: ${detalhe}`;
}

async function lerResposta(response) {
  const texto = await response.text().catch(() => '');
  let data = null;

  if (texto) {
    try {
      data = JSON.parse(texto);
    } catch (_) {
      data = { raw: texto };
    }
  }

  if (!response.ok || data?.error) {
    throw new Error(mensagemErroMeta(data, texto, response.status));
  }

  return data || {};
}

function montarEndpoint(config, recurso) {
  const parte = String(recurso || '').replace(/^\/+/, '');
  return `${config.baseUrl}/${config.apiVersion}/${parte}`;
}

async function postGraph(config, recurso, parametros) {
  const url = montarEndpoint(config, recurso);
  const body = new URLSearchParams();

  Object.entries(parametros || {}).forEach(([chave, valor]) => {
    if (valor !== undefined && valor !== null && String(valor) !== '') {
      body.set(chave, String(valor));
    }
  });
  body.set('access_token', config.accessToken);

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
  } catch (error) {
    throw new Error(`Falha ao conectar à API do Instagram/Meta: ${error.message}`);
  }

  return lerResposta(response);
}

async function getGraph(config, recurso, parametros = {}) {
  const url = new URL(montarEndpoint(config, recurso));
  Object.entries(parametros).forEach(([chave, valor]) => {
    if (valor !== undefined && valor !== null && String(valor) !== '') {
      url.searchParams.set(chave, String(valor));
    }
  });
  url.searchParams.set('access_token', config.accessToken);

  let response;
  try {
    response = await fetch(url, { method: 'GET' });
  } catch (error) {
    throw new Error(`Falha ao conectar à API do Instagram/Meta: ${error.message}`);
  }

  return lerResposta(response);
}

function aguardar(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function criarContainerStoryImagem(config, imageUrl) {
  const url = String(imageUrl || '').trim();
  if (!/^https:\/\//i.test(url)) {
    throw new Error('A imagem do Story precisa estar disponível em uma URL pública HTTPS.');
  }

  const data = await postGraph(config, `${config.igUserId}/media`, {
    image_url: url,
    media_type: 'STORIES',
  });

  if (!data.id) {
    throw new Error('A Meta não retornou o ID do container do Story.');
  }

  return String(data.id);
}

async function criarContainerStoryVideo(config, videoUrl) {
  const url = String(videoUrl || '').trim();
  if (!/^https:\/\//i.test(url)) {
    throw new Error('O vídeo do Story precisa estar disponível em uma URL pública HTTPS.');
  }

  const data = await postGraph(config, `${config.igUserId}/media`, {
    video_url: url,
    media_type: 'STORIES',
  });

  if (!data.id) {
    throw new Error('A Meta não retornou o ID do container do Story em vídeo.');
  }

  return String(data.id);
}

async function obterStatusContainer(config, containerId) {
  return getGraph(config, containerId, { fields: 'status_code,status' });
}

async function aguardarContainer(config, containerId, pollAttempts = config.pollAttempts) {
  let ultimo = null;
  const tentativasMaximas = inteiroPositivo(pollAttempts, config.pollAttempts);

  for (let tentativa = 1; tentativa <= tentativasMaximas; tentativa += 1) {
    ultimo = await obterStatusContainer(config, containerId);
    const statusCode = String(ultimo?.status_code || '').trim().toUpperCase();

    if (statusCode === 'FINISHED') return ultimo;

    if (['ERROR', 'EXPIRED'].includes(statusCode)) {
      throw new Error(`A Meta não conseguiu processar o Story: ${ultimo?.status || statusCode}.`);
    }

    if (tentativa < tentativasMaximas) {
      await aguardar(config.pollIntervalMs);
    }
  }

  const status = ultimo?.status || ultimo?.status_code || 'sem status';
  throw new Error(`Tempo excedido aguardando a Meta processar o Story (${status}).`);
}

async function publicarContainer(config, containerId) {
  const data = await postGraph(config, `${config.igUserId}/media_publish`, {
    creation_id: containerId,
  });

  if (!data.id) {
    throw new Error('A Meta não retornou o ID da mídia publicada no Instagram.');
  }

  return String(data.id);
}

async function publicarStoryImagem({ imageUrl }) {
  const config = validarConfiguracao(getConfig());
  const containerId = await criarContainerStoryImagem(config, imageUrl);
  const processamento = await aguardarContainer(config, containerId);
  const mediaId = await publicarContainer(config, containerId);

  return {
    success: true,
    status: 'publicado',
    media_id: mediaId,
    container_id: containerId,
    processamento_status: processamento?.status_code || null,
    api_version: config.apiVersion,
  };
}

async function publicarStoryVideo({ videoUrl }) {
  const config = validarConfiguracao(getConfig());
  const containerId = await criarContainerStoryVideo(config, videoUrl);
  // Vídeos podem demorar mais que imagens para a Meta terminar o processamento.
  const tentativasVideo = Math.max(config.pollAttempts, 40);
  const processamento = await aguardarContainer(config, containerId, tentativasVideo);
  const mediaId = await publicarContainer(config, containerId);

  return {
    success: true,
    status: 'publicado',
    media_id: mediaId,
    container_id: containerId,
    processamento_status: processamento?.status_code || null,
    api_version: config.apiVersion,
  };
}

module.exports = {
  diagnosticarConfiguracao,
  publicarStoryImagem,
  publicarStoryVideo,
};
