const fs = require('fs');

function getApiKey() {
  return String(process.env.OPENAI_API_KEY || '').trim();
}

function getModel() {
  // Variável separada porque a arte completa usa edição com várias imagens
  // de entrada e exige um modelo com boa fidelidade visual.
  return String(process.env.OPENAI_IMAGE_MODEL_FULL_ART || 'gpt-image-1').trim();
}

function getQuality() {
  return String(process.env.OPENAI_IMAGE_QUALITY || 'medium').trim();
}

function getMaxRetries() {
  const value = Number.parseInt(process.env.OPENAI_IMAGE_MAX_RETRIES || '3', 10);
  return Number.isInteger(value) && value >= 0 ? Math.min(value, 5) : 3;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isRetryableStatus(status) {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

function normalizarReferencias(referencias) {
  return (Array.isArray(referencias) ? referencias : []).filter((referencia) => {
    if (referencia?.buffer && Buffer.isBuffer(referencia.buffer)) return true;
    if (referencia?.caminho && fs.existsSync(referencia.caminho)) return true;
    return false;
  });
}

async function executarEdicao({ prompt, referencias = [] }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180000);

  try {
    const arquivos = normalizarReferencias(referencias);
    if (!arquivos.length) {
      throw new Error('Nenhuma foto real de produto foi preparada para a arte.');
    }

    const form = new FormData();
    form.append('model', getModel());
    form.append('prompt', prompt);
    form.append('size', '1024x1536');
    form.append('quality', getQuality());
    form.append('background', 'opaque');
    form.append('output_format', 'jpeg');
    form.append('input_fidelity', 'high');

    arquivos.forEach((arquivo, indice) => {
      const buffer = arquivo.buffer || fs.readFileSync(arquivo.caminho);
      const tipo = arquivo.tipo || 'image/jpeg';
      const nome = arquivo.nome || `produto-${String(indice + 1).padStart(2, '0')}.jpg`;
      form.append('image[]', new Blob([buffer], { type: tipo }), nome);
    });

    const response = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST',
      headers: { Authorization: `Bearer ${getApiKey()}` },
      signal: controller.signal,
      body: form,
    });

    const texto = await response.text();
    let data;
    try { data = texto ? JSON.parse(texto) : {}; } catch (_) { data = { raw: texto }; }

    if (!response.ok) {
      const detalhe = data?.error?.message || data?.message || texto || 'Falha ao gerar a arte.';
      const requestId = response.headers.get('x-request-id') || data?.error?.request_id || '';
      const erro = new Error(`OpenAI Images respondeu ${response.status}: ${detalhe}${requestId ? ` (request ID: ${requestId})` : ''}`);
      erro.status = response.status;
      erro.requestId = requestId;
      throw erro;
    }

    const base64 = data?.data?.[0]?.b64_json;
    if (!base64) {
      const erro = new Error('A OpenAI não retornou a arte em Base64.');
      erro.status = 502;
      throw erro;
    }

    return Buffer.from(base64, 'base64');
  } finally {
    clearTimeout(timeout);
  }
}

async function gerarArteCompleta({ prompt, referencias = [] }) {
  if (!getApiKey()) throw new Error('OPENAI_API_KEY não configurada.');

  const maxRetries = getMaxRetries();
  let ultimoErro;

  for (let tentativa = 0; tentativa <= maxRetries; tentativa += 1) {
    try {
      return await executarEdicao({ prompt, referencias });
    } catch (error) {
      ultimoErro = error;
      const retryable = error?.name === 'AbortError' || isRetryableStatus(Number(error?.status || 0));
      const ultimaTentativa = tentativa >= maxRetries;
      console.warn(`[Ofertas] Falha ao gerar arte integral (tentativa ${tentativa + 1}/${maxRetries + 1}):`, error.message);
      if (!retryable || ultimaTentativa) break;
      await sleep(Math.min(15000, 2000 * (2 ** tentativa)));
    }
  }

  throw ultimoErro || new Error('Não foi possível gerar a arte integral pela IA.');
}

module.exports = { gerarArteCompleta };
