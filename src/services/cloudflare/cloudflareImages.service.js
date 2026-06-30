const MAX_UPLOAD_SIZE_MB = 10;

function getConfig() {
  return {
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID || '',
    token: process.env.CLOUDFLARE_IMAGES_TOKEN || '',
    accountHash: process.env.CLOUDFLARE_IMAGES_ACCOUNT_HASH || '',
    variant: process.env.CLOUDFLARE_IMAGES_VARIANT || 'public',
  };
}

function validarConfiguracao(config) {
  if (!config.accountId || !config.token) {
    throw new Error('Cloudflare Images nao configurado. Configure CLOUDFLARE_ACCOUNT_ID e CLOUDFLARE_IMAGES_TOKEN.');
  }
}

function escolherUrlImagem(result, config) {
  const variantes = Array.isArray(result?.variants) ? result.variants : [];

  if (config.variant && variantes.length > 0) {
    const varianteEncontrada = variantes.find((url) => String(url).endsWith(`/${config.variant}`));
    if (varianteEncontrada) return varianteEncontrada;
  }

  if (variantes[0]) return variantes[0];

  if (config.accountHash && result?.id) {
    return `https://imagedelivery.net/${config.accountHash}/${result.id}/${config.variant || 'public'}`;
  }

  throw new Error('Cloudflare retornou a imagem, mas nao retornou URL publica. Configure CLOUDFLARE_IMAGES_ACCOUNT_HASH ou uma variante publica.');
}

async function uploadImagem(file, metadata = {}) {
  const config = getConfig();
  validarConfiguracao(config);

  if (!file || !file.buffer) {
    throw new Error('Arquivo de imagem nao recebido.');
  }

  const formData = new FormData();
  const blob = new Blob([file.buffer], { type: file.mimetype || 'application/octet-stream' });

  formData.append('file', blob, file.originalname || 'produto.jpg');

  if (metadata && Object.keys(metadata).length > 0) {
    formData.append('metadata', JSON.stringify(metadata));
  }

  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${config.accountId}/images/v1`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.token}`,
    },
    body: formData,
  });

  const json = await response.json().catch(() => null);

  if (!response.ok || !json?.success) {
    const mensagem = json?.errors?.map((erro) => erro.message).filter(Boolean).join(' | ')
      || `Erro HTTP ${response.status} ao enviar imagem para Cloudflare.`;
    throw new Error(mensagem);
  }

  const result = json.result;
  const url = escolherUrlImagem(result, config);

  return {
    id: result.id,
    filename: result.filename || file.originalname || null,
    url,
    tamanhoMbLimite: MAX_UPLOAD_SIZE_MB,
  };
}

module.exports = {
  uploadImagem,
  MAX_UPLOAD_SIZE_MB,
};
