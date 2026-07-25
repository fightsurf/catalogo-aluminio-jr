function getApiKey() {
  return String(process.env.OPENAI_API_KEY || '').trim();
}

function getModel() {
  return String(process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1-mini').trim();
}

async function gerarCenarioVertical(prompt) {
  const apiKey = getApiKey();
  if (!apiKey) return null;

  const response = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: getModel(),
      prompt,
      size: '1024x1536',
      quality: process.env.OPENAI_IMAGE_QUALITY || 'medium',
      background: 'opaque',
      output_format: 'png',
    }),
  });

  const texto = await response.text();
  let data;
  try { data = texto ? JSON.parse(texto) : {}; } catch (_) { data = { raw: texto }; }

  if (!response.ok) {
    const detalhe = data?.error?.message || data?.message || texto || 'Falha ao gerar cenário.';
    throw new Error(`OpenAI Images respondeu ${response.status}: ${detalhe}`);
  }

  const base64 = data?.data?.[0]?.b64_json;
  if (!base64) throw new Error('A OpenAI não retornou a imagem em Base64.');
  return Buffer.from(base64, 'base64');
}

module.exports = { gerarCenarioVertical };
