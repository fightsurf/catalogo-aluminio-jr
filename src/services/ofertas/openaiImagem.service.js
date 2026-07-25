function getApiKey() {
  return String(process.env.OPENAI_API_KEY || '').trim();
}

function getModel() {
  return String(process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1-mini').trim();
}

function getQuality() {
  return String(process.env.OPENAI_IMAGE_QUALITY || 'medium').trim();
}

function getMaxRetries() {
  const value = Number(process.env.OPENAI_IMAGE_MAX_RETRIES || 3);
  return Number.isFinite(value) ? Math.max(0, Math.min(5, Math.floor(value))) : 3;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status) {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

async function executarGeracao(prompt) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);

  try {
    const response = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${getApiKey()}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: getModel(),
        prompt,
        size: '1024x1536',
        quality: getQuality(),
        background: 'opaque',
        output_format: 'png',
      }),
    });

    const texto = await response.text();
    let data;
    try { data = texto ? JSON.parse(texto) : {}; } catch (_) { data = { raw: texto }; }

    if (!response.ok) {
      const detalhe = data?.error?.message || data?.message || texto || 'Falha ao gerar cenário.';
      const requestId = response.headers.get('x-request-id') || data?.error?.request_id || '';
      const erro = new Error(`OpenAI Images respondeu ${response.status}: ${detalhe}${requestId ? ` (request ID: ${requestId})` : ''}`);
      erro.status = response.status;
      erro.requestId = requestId;
      throw erro;
    }

    const base64 = data?.data?.[0]?.b64_json;
    if (!base64) {
      const erro = new Error('A OpenAI não retornou a imagem em Base64.');
      erro.status = 502;
      throw erro;
    }

    return Buffer.from(base64, 'base64');
  } finally {
    clearTimeout(timeout);
  }
}

async function gerarCenarioVertical(prompt) {
  const apiKey = getApiKey();
  if (!apiKey) {
    console.warn('[Ofertas] OPENAI_API_KEY ausente. Usando fundo local.');
    return null;
  }

  const maxRetries = getMaxRetries();
  let ultimoErro;

  for (let tentativa = 0; tentativa <= maxRetries; tentativa += 1) {
    try {
      return await executarGeracao(prompt);
    } catch (error) {
      ultimoErro = error;
      const retryable = error?.name === 'AbortError' || isRetryableStatus(Number(error?.status || 0));
      const ultimaTentativa = tentativa >= maxRetries;

      console.warn(`[Ofertas] Falha na OpenAI Images (tentativa ${tentativa + 1}/${maxRetries + 1}):`, error.message);

      if (!retryable || ultimaTentativa) break;
      const esperaMs = Math.min(15000, 2000 * (2 ** tentativa));
      await sleep(esperaMs);
    }
  }

  // A arte não deve falhar por indisponibilidade temporária da OpenAI.
  // O serviço de composição detecta null e usa um fundo local seguro.
  console.error('[Ofertas] OpenAI indisponível após as tentativas. Usando fundo local:', ultimoErro?.message);

  if (String(process.env.OPENAI_IMAGE_STRICT || '').toLowerCase() === 'true') {
    throw ultimoErro;
  }

  return null;
}

module.exports = { gerarCenarioVertical };
