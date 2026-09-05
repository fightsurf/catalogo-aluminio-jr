const metaRateLimitService = require('./meta-rate-limit.service');

const DEFAULT_GRAPH_BASE_URL = 'https://graph.facebook.com';
const DEFAULT_API_VERSION = 'v25.0';
const DEFAULT_POLL_INTERVAL_MS = 60 * 1000;
const DEFAULT_POLL_ATTEMPTS = 5;
const MIN_POLL_INTERVAL_MS = 60 * 1000;
const MAX_POLL_ATTEMPTS = 5;
const DEFAULT_QUOTA_CACHE_MS = 5 * 60 * 1000;

let quotaCache = null;
let quotaPromise = null;

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
  const pollIntervalInformado = inteiroPositivo(
    process.env.INSTAGRAM_CONTAINER_POLL_INTERVAL_MS,
    DEFAULT_POLL_INTERVAL_MS
  );
  const pollAttemptsInformado = inteiroPositivo(
    process.env.INSTAGRAM_CONTAINER_POLL_ATTEMPTS,
    DEFAULT_POLL_ATTEMPTS
  );

  return {
    baseUrl: normalizarBaseUrl(process.env.INSTAGRAM_GRAPH_BASE_URL || DEFAULT_GRAPH_BASE_URL),
    apiVersion: normalizarVersao(process.env.INSTAGRAM_GRAPH_API_VERSION || DEFAULT_API_VERSION),
    igUserId: normalizarValor(process.env.INSTAGRAM_IG_USER_ID || ''),
    accessToken: normalizarValor(process.env.INSTAGRAM_ACCESS_TOKEN || ''),
    // A Meta recomenda consultar o status do container no máximo uma vez por minuto,
    // por no máximo cinco minutos. Variáveis antigas com valores agressivos são limitadas aqui.
    pollIntervalMs: Math.max(pollIntervalInformado, MIN_POLL_INTERVAL_MS),
    pollAttempts: Math.min(pollAttemptsInformado, MAX_POLL_ATTEMPTS),
    quotaCacheMs: inteiroPositivo(process.env.INSTAGRAM_QUOTA_CACHE_MS, DEFAULT_QUOTA_CACHE_MS),
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
    poll_interval_ms: config.pollIntervalMs,
    poll_attempts: config.pollAttempts,
    meta_rate_limit: metaRateLimitService.estado(),
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

async function lerResposta(response, origem) {
  const telemetria = metaRateLimitService.registrarResposta({ response, origem });
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
    const metaErro = metaRateLimitService.registrarErro({ response, data, telemetria, origem });
    const mensagemBase = mensagemErroMeta(data, texto, response.status);
    const mensagem = metaErro.rate_limited
      ? `${mensagemBase}. Meta temporariamente limitada; novas chamadas Meta foram suspensas automaticamente.`
      : mensagemBase;
    const error = new Error(mensagem);
    Object.assign(error, {
      meta_rate_limited: metaErro.rate_limited,
      meta_code: metaErro.codigo,
      meta_subcode: metaErro.subcodigo,
      fbtrace_id: metaErro.fbtrace_id,
      retry_after_seconds: metaErro.retry_after_seconds,
    });
    throw error;
  }

  return data || {};
}

function montarEndpoint(config, recurso) {
  const parte = String(recurso || '').replace(/^\/+/, '');
  return `${config.baseUrl}/${config.apiVersion}/${parte}`;
}

async function postGraph(config, recurso, parametros, origem = 'instagram') {
  metaRateLimitService.verificarDisponibilidade(origem);
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

  return lerResposta(response, origem);
}

async function getGraph(config, recurso, parametros = {}, origem = 'instagram') {
  metaRateLimitService.verificarDisponibilidade(origem);
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

  return lerResposta(response, origem);
}

function aguardar(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizarQuota(data) {
  const item = Array.isArray(data?.data) ? data.data[0] : null;
  const uso = Number(item?.quota_usage);
  const total = Number(item?.config?.quota_total);
  const duracao = Number(item?.config?.quota_duration);
  if (!Number.isFinite(uso) || !Number.isFinite(total) || total <= 0) return null;
  return {
    quota_usage: uso,
    quota_total: total,
    quota_duration: Number.isFinite(duracao) && duracao > 0 ? duracao : null,
    restante: Math.max(0, total - uso),
  };
}

async function obterLimitePublicacao(config, { forcar = false } = {}) {
  const agora = Date.now();
  if (!forcar && quotaCache?.expiraEm > agora) return quotaCache.valor;
  if (!forcar && quotaPromise) return quotaPromise;

  const consultar = async () => {
    const data = await getGraph(
      config,
      `${config.igUserId}/content_publishing_limit`,
      { fields: 'quota_usage,config' },
      'instagram_content_publishing_limit'
    );
    const quota = normalizarQuota(data);
    quotaCache = { valor: quota, expiraEm: Date.now() + config.quotaCacheMs };

    if (quota) {
      const percentual = Math.round((quota.quota_usage / quota.quota_total) * 100);
      console.log('[Instagram] limite de publicação', { ...quota, percentual });
      if (percentual >= 80) {
        console.warn('[Instagram] quota de publicação acima de 80%', { ...quota, percentual });
      }
    }
    return quota;
  };

  if (forcar) return consultar();
  quotaPromise = consultar();
  try {
    return await quotaPromise;
  } finally {
    quotaPromise = null;
  }
}

async function verificarLimiteAntesDePublicar(config) {
  let quota;
  try {
    quota = await obterLimitePublicacao(config);
  } catch (error) {
    // Se a própria consulta de quota foi bloqueada pela Meta, respeitamos o circuit breaker.
    if (error?.meta_rate_limited || error?.meta_circuit_open) throw error;
    // Falha de observabilidade não deve derrubar uma publicação que ainda poderia funcionar.
    // Cacheamos a falha por alguns minutos para não transformar monitoramento em chamadas extras.
    quotaCache = {
      valor: null,
      expiraEm: Date.now() + config.quotaCacheMs,
      erro: String(error?.message || error),
    };
    console.warn('[Instagram] não foi possível consultar content_publishing_limit:', error.message);
    return null;
  }

  if (quota && quota.quota_usage >= quota.quota_total) {
    const error = new Error(
      `Instagram atingiu o limite oficial de publicações pela API `
      + `(${quota.quota_usage}/${quota.quota_total} na janela atual). Tente novamente após a quota liberar.`
    );
    error.instagram_publishing_quota = true;
    error.quota = quota;
    throw error;
  }
  return quota;
}

async function criarContainerStoryImagem(config, imageUrl) {
  const url = String(imageUrl || '').trim();
  if (!/^https:\/\//i.test(url)) {
    throw new Error('A imagem do Story precisa estar disponível em uma URL pública HTTPS.');
  }

  const data = await postGraph(config, `${config.igUserId}/media`, {
    image_url: url,
    media_type: 'STORIES',
  }, 'instagram_story_criar_container');

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
  }, 'instagram_story_video_criar_container');

  if (!data.id) {
    throw new Error('A Meta não retornou o ID do container do Story em vídeo.');
  }

  return String(data.id);
}

async function obterStatusContainer(config, containerId) {
  return getGraph(
    config,
    containerId,
    { fields: 'status_code,status' },
    'instagram_container_status'
  );
}

async function aguardarContainer(config, containerId) {
  let ultimo = null;

  // Mantém o comportamento que já era estável no Status Zap: a primeira
  // conferência acontece imediatamente após a criação do container.
  // Se a Meta ainda estiver processando, as novas consultas respeitam o
  // intervalo conservador (mínimo de 60 s) e o máximo de cinco tentativas.
  for (let tentativa = 1; tentativa <= config.pollAttempts; tentativa += 1) {
    if (tentativa > 1) {
      await aguardar(config.pollIntervalMs);
    }

    ultimo = await obterStatusContainer(config, containerId);
    const statusCode = String(ultimo?.status_code || '').trim().toUpperCase();

    if (['FINISHED', 'PUBLISHED'].includes(statusCode)) return ultimo;

    if (['ERROR', 'EXPIRED'].includes(statusCode)) {
      throw new Error(`A Meta não conseguiu processar o Story: ${ultimo?.status || statusCode}.`);
    }
  }

  const status = ultimo?.status || ultimo?.status_code || 'sem status';
  throw new Error(`Tempo excedido aguardando a Meta processar o Story (${status}).`);
}

function registrarPublicacaoNaQuotaCache() {
  if (!quotaCache?.valor || quotaCache.expiraEm <= Date.now()) return;
  quotaCache.valor = {
    ...quotaCache.valor,
    quota_usage: quotaCache.valor.quota_usage + 1,
    restante: Math.max(0, quotaCache.valor.quota_total - quotaCache.valor.quota_usage - 1),
  };
}

async function publicarContainer(config, containerId) {
  const data = await postGraph(config, `${config.igUserId}/media_publish`, {
    creation_id: containerId,
  }, 'instagram_story_publicar_container');

  if (!data.id) {
    throw new Error('A Meta não retornou o ID da mídia publicada no Instagram.');
  }

  // Evita consultar /content_publishing_limit de novo a cada produto do mesmo lote.
  registrarPublicacaoNaQuotaCache();
  return String(data.id);
}

async function publicarStoryImagem({ imageUrl }) {
  const config = validarConfiguracao(getConfig());
  const quota = await verificarLimiteAntesDePublicar(config);
  const containerId = await criarContainerStoryImagem(config, imageUrl);

  // Não publicar a imagem antes de a Meta declarar o container pronto.
  // A retirada desta espera causou os erros 9007/2207027 (Media ID is not
  // available) e 24/2207006 em parte dos produtos do Status Zap.
  const processamento = await aguardarContainer(config, containerId);
  const mediaId = await publicarContainer(config, containerId);

  return {
    success: true,
    status: 'publicado',
    media_id: mediaId,
    container_id: containerId,
    processamento_status: processamento?.status_code || null,
    api_version: config.apiVersion,
    publishing_quota: quota,
  };
}

async function publicarStoryVideo({ videoUrl }) {
  const config = validarConfiguracao(getConfig());
  const quota = await verificarLimiteAntesDePublicar(config);
  const containerId = await criarContainerStoryVideo(config, videoUrl);
  const processamento = await aguardarContainer(config, containerId);
  const mediaId = await publicarContainer(config, containerId);

  return {
    success: true,
    status: 'publicado',
    media_id: mediaId,
    container_id: containerId,
    processamento_status: processamento?.status_code || null,
    api_version: config.apiVersion,
    publishing_quota: quota,
  };
}

module.exports = {
  diagnosticarConfiguracao,
  obterLimitePublicacao,
  publicarStoryImagem,
  publicarStoryVideo,
};
