const DEFAULT_FALLBACK_COOLDOWN_MS = 15 * 60 * 1000;
const MAX_COOLDOWN_MS = 24 * 60 * 60 * 1000;

let bloqueioGlobalAte = 0;
let bloqueioGlobalMotivo = '';
let ultimaTelemetria = null;

function numeroPositivo(valor, padrao) {
  const numero = Number.parseInt(String(valor ?? ''), 10);
  return Number.isFinite(numero) && numero > 0 ? numero : padrao;
}

function fallbackCooldownMs() {
  return Math.min(
    numeroPositivo(process.env.META_RATE_LIMIT_FALLBACK_MS, DEFAULT_FALLBACK_COOLDOWN_MS),
    MAX_COOLDOWN_MS
  );
}

function parseJsonHeader(valor) {
  const texto = String(valor || '').trim();
  if (!texto) return null;
  try { return JSON.parse(texto); } catch (_) { return texto; }
}

function retryAfterMs(valor) {
  const texto = String(valor || '').trim();
  if (!texto) return 0;

  const segundos = Number(texto);
  if (Number.isFinite(segundos) && segundos > 0) {
    return Math.min(Math.ceil(segundos * 1000), MAX_COOLDOWN_MS);
  }

  const data = Date.parse(texto);
  if (Number.isFinite(data) && data > Date.now()) {
    return Math.min(data - Date.now(), MAX_COOLDOWN_MS);
  }
  return 0;
}

function coletarEstimativasMinutos(valor, saida = []) {
  if (!valor || typeof valor !== 'object') return saida;
  if (Array.isArray(valor)) {
    valor.forEach(item => coletarEstimativasMinutos(item, saida));
    return saida;
  }

  Object.entries(valor).forEach(([chave, item]) => {
    if (chave === 'estimated_time_to_regain_access') {
      const minutos = Number(item);
      if (Number.isFinite(minutos) && minutos > 0) saida.push(minutos);
      return;
    }
    coletarEstimativasMinutos(item, saida);
  });
  return saida;
}

function estimativaRecuperacaoMs(telemetria) {
  const minutos = coletarEstimativasMinutos(telemetria?.business_use_case_usage || []);
  if (!minutos.length) return 0;
  return Math.min(Math.ceil(Math.max(...minutos) * 60 * 1000), MAX_COOLDOWN_MS);
}

function telemetriaResposta(response, origem) {
  const telemetria = {
    origem: String(origem || 'meta'),
    status_http: Number(response?.status || 0),
    app_usage: parseJsonHeader(response?.headers?.get?.('x-app-usage')),
    business_use_case_usage: parseJsonHeader(response?.headers?.get?.('x-business-use-case-usage')),
    page_usage: parseJsonHeader(response?.headers?.get?.('x-page-usage')),
    retry_after: String(response?.headers?.get?.('retry-after') || '').trim() || null,
    fb_request_id: String(response?.headers?.get?.('x-fb-request-id') || '').trim() || null,
    fb_trace_id: String(response?.headers?.get?.('x-fb-trace-id') || '').trim() || null,
  };

  const possuiUso = telemetria.app_usage || telemetria.business_use_case_usage || telemetria.page_usage || telemetria.retry_after;
  if (possuiUso || telemetria.status_http >= 400) {
    console.log('[Meta API] uso/limites', telemetria);
  }
  ultimaTelemetria = telemetria;
  return telemetria;
}

function codigoErro(data) {
  const codigo = Number(data?.error?.code);
  return Number.isFinite(codigo) ? codigo : null;
}

function subcodigoErro(data) {
  const codigo = Number(data?.error?.error_subcode);
  return Number.isFinite(codigo) ? codigo : null;
}

function fbtraceId(data) {
  return String(data?.error?.fbtrace_id || data?.fbtrace_id || '').trim() || null;
}

function ehRateLimit({ status, data }) {
  return Number(status) === 429 || codigoErro(data) === 4;
}

function ativarBloqueioGlobal({ telemetria, data, origem }) {
  const porRetryAfter = retryAfterMs(telemetria?.retry_after);
  const porBusinessUsage = estimativaRecuperacaoMs(telemetria);
  const informadoPelaMeta = Math.max(porRetryAfter, porBusinessUsage);
  const duracao = informadoPelaMeta > 0 ? informadoPelaMeta : fallbackCooldownMs();
  const novoAte = Date.now() + duracao;

  if (novoAte > bloqueioGlobalAte) bloqueioGlobalAte = novoAte;
  bloqueioGlobalMotivo = `Meta limitou as requisições (${origem || 'API'}, código ${codigoErro(data) || 'HTTP 429'}).`;

  console.warn('[Meta API] circuit breaker ativado', {
    origem: origem || 'meta',
    codigo: codigoErro(data),
    subcodigo: subcodigoErro(data),
    fbtrace_id: fbtraceId(data) || telemetria?.fb_trace_id || telemetria?.fb_request_id || null,
    bloqueado_ate: new Date(bloqueioGlobalAte).toISOString(),
    retry_after: telemetria?.retry_after || null,
    business_use_case_usage: telemetria?.business_use_case_usage || null,
  });
}

function segundosRestantes() {
  return Math.max(0, Math.ceil((bloqueioGlobalAte - Date.now()) / 1000));
}

function verificarDisponibilidade(origem = 'Meta') {
  if (bloqueioGlobalAte <= Date.now()) {
    if (bloqueioGlobalAte) {
      console.log('[Meta API] circuit breaker liberado', { origem });
    }
    bloqueioGlobalAte = 0;
    bloqueioGlobalMotivo = '';
    return;
  }

  const segundos = segundosRestantes();
  const minutos = Math.max(1, Math.ceil(segundos / 60));
  const error = new Error(
    `Meta temporariamente limitada — nenhuma nova chamada foi feita. `
    + `Tente novamente após a liberação da API (aprox. ${minutos} min).`
  );
  error.meta_rate_limited = true;
  error.meta_circuit_open = true;
  error.retry_after_seconds = segundos;
  error.origem = origem;
  throw error;
}

function registrarResposta({ response, origem }) {
  return telemetriaResposta(response, origem);
}

function registrarErro({ response, data, telemetria, origem }) {
  const info = telemetria || telemetriaResposta(response, origem);
  if (ehRateLimit({ status: response?.status, data })) {
    ativarBloqueioGlobal({ telemetria: info, data, origem });
  }

  return {
    rate_limited: ehRateLimit({ status: response?.status, data }),
    codigo: codigoErro(data),
    subcodigo: subcodigoErro(data),
    fbtrace_id: fbtraceId(data) || info?.fb_trace_id || info?.fb_request_id || null,
    retry_after_seconds: segundosRestantes(),
  };
}

function estado() {
  return {
    bloqueado: bloqueioGlobalAte > Date.now(),
    bloqueado_ate: bloqueioGlobalAte > Date.now() ? new Date(bloqueioGlobalAte).toISOString() : null,
    segundos_restantes: segundosRestantes(),
    motivo: bloqueioGlobalMotivo || null,
    ultima_telemetria: ultimaTelemetria,
  };
}

module.exports = {
  verificarDisponibilidade,
  registrarResposta,
  registrarErro,
  estado,
};
