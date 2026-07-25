const fs = require('fs');
const path = require('path');

function getApiKey() {
  return String(process.env.OPENAI_API_KEY || '').trim();
}

function getModel() {
  // A arte integral usa imagens de referência. O modelo mini não oferece
  // a mesma fidelidade de entrada; por isso há uma variável separada.
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

function referenciaVisualPadrao() {
  return path.resolve(__dirname, '../../../public/assets/ofertas/referencia-kit-top.jpg');
}

async function executarEdicao({ prompt, referencias = [] }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180000);

  try {
    const form = new FormData();
    form.append('model', getModel());
    form.append('prompt', prompt);
    form.append('size', '1024x1536');
    form.append('quality', getQuality());
    form.append('background', 'opaque');
    form.append('output_format', 'jpeg');
    form.append('input_fidelity', 'high');

    const arquivos = [];
    const visual = referenciaVisualPadrao();
    if (fs.existsSync(visual)) {
      arquivos.push({ buffer: fs.readFileSync(visual), nome: 'referencia-visual.jpg', tipo: 'image/jpeg' });
    }
    for (const referencia of referencias) {
      if (referencia?.buffer) arquivos.push(referencia);
    }

    if (!arquivos.length) throw new Error('Nenhuma imagem de referência foi preparada para a arte.');

    arquivos.forEach((arquivo) => {
      form.append('image[]', new Blob([arquivo.buffer], { type: arquivo.tipo || 'image/png' }), arquivo.nome || 'referencia.png');
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
