const crypto = require('crypto');
const path = require('path');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const MAX_UPLOAD_SIZE_MB = 10;

const EXTENSOES_POR_MIME = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

let clientCache = null;
let clientCacheKey = null;

function normalizarVariavelAmbiente(valor) {
  let resultado = String(valor ?? '').trim();

  // No painel do Render, aspas não são necessárias. Caso tenham sido
  // coladas junto com o valor, elas passam a fazer parte da credencial.
  if (
    resultado.length >= 2
    && ((resultado.startsWith('"') && resultado.endsWith('"'))
      || (resultado.startsWith("'") && resultado.endsWith("'")))
  ) {
    resultado = resultado.slice(1, -1).trim();
  }

  return resultado;
}

function removerBarraFinal(valor) {
  return normalizarVariavelAmbiente(valor).replace(/\/+$/, '');
}

function montarEndpoint(accountId, endpointConfigurado) {
  const endpoint = removerBarraFinal(endpointConfigurado);
  if (endpoint) return endpoint;

  return `https://${accountId}.r2.cloudflarestorage.com`;
}

function getConfig() {
  const accountId = normalizarVariavelAmbiente(
    process.env.CLOUDFLARE_R2_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID || ''
  );

  return {
    accountId,
    endpoint: montarEndpoint(accountId, process.env.CLOUDFLARE_R2_ENDPOINT || ''),
    accessKeyId: normalizarVariavelAmbiente(process.env.CLOUDFLARE_R2_ACCESS_KEY_ID || ''),
    secretAccessKey: normalizarVariavelAmbiente(process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY || ''),
    bucket: normalizarVariavelAmbiente(process.env.CLOUDFLARE_R2_BUCKET || ''),
    publicUrl: removerBarraFinal(process.env.CLOUDFLARE_R2_PUBLIC_URL || ''),
  };
}

function validarConfiguracao(config) {
  const faltando = [];

  if (!config.accountId) faltando.push('CLOUDFLARE_R2_ACCOUNT_ID');
  if (!config.accessKeyId) faltando.push('CLOUDFLARE_R2_ACCESS_KEY_ID');
  if (!config.secretAccessKey) faltando.push('CLOUDFLARE_R2_SECRET_ACCESS_KEY');
  if (!config.bucket) faltando.push('CLOUDFLARE_R2_BUCKET');
  if (!config.publicUrl) faltando.push('CLOUDFLARE_R2_PUBLIC_URL');

  if (faltando.length > 0) {
    throw new Error(`Cloudflare R2 nao configurado. Configure: ${faltando.join(', ')}.`);
  }

  if (/^https?:\/\//i.test(config.bucket)) {
    throw new Error('CLOUDFLARE_R2_BUCKET deve conter apenas o nome do bucket, nao uma URL.');
  }

  let endpoint;
  try {
    endpoint = new URL(config.endpoint);
  } catch (_) {
    throw new Error('CLOUDFLARE_R2_ENDPOINT invalido. Use a URL S3 exibida pelo Cloudflare R2.');
  }

  if (endpoint.protocol !== 'https:') {
    throw new Error('CLOUDFLARE_R2_ENDPOINT deve usar HTTPS.');
  }

  if (!endpoint.hostname.endsWith('.r2.cloudflarestorage.com')) {
    throw new Error('CLOUDFLARE_R2_ENDPOINT deve ser o endpoint S3 do Cloudflare R2.');
  }
}

function getClient(config) {
  const cacheKey = [config.endpoint, config.accessKeyId, config.secretAccessKey].join('|');

  if (clientCache && clientCacheKey === cacheKey) {
    return clientCache;
  }

  clientCache = new S3Client({
    region: 'auto',
    endpoint: config.endpoint,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    maxAttempts: 2,
  });
  clientCacheKey = cacheKey;

  return clientCache;
}

function obterExtensao(file) {
  const porMime = EXTENSOES_POR_MIME[file?.mimetype];
  if (porMime) return porMime;

  const extOriginal = path.extname(file?.originalname || '').replace(/^\./, '').toLowerCase();
  return extOriginal || 'jpg';
}

function normalizarParteChave(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'produto';
}

function montarChaveArquivo(file, metadata = {}) {
  const produtoId = normalizarParteChave(metadata.produto_id || 'sem-id');
  const posicao = normalizarParteChave(metadata.posicao || '1');
  const ext = obterExtensao(file);
  const aleatorio = crypto.randomBytes(6).toString('hex');
  const timestamp = Date.now();

  return `produtos/${produtoId}/foto-${posicao}-${timestamp}-${aleatorio}.${ext}`;
}

function montarUrlPublica(publicUrl, key) {
  const partes = String(key).split('/').map((parte) => encodeURIComponent(parte));
  return `${publicUrl}/${partes.join('/')}`;
}

function extrairCodigoErro(error) {
  return String(error?.name || error?.Code || error?.code || '').trim();
}

function traduzirErroR2(error) {
  const codigo = extrairCodigoErro(error);

  if (codigo === 'SignatureDoesNotMatch') {
    return new Error(
      'Cloudflare R2 recusou a assinatura. No Render, confirme que '
      + 'CLOUDFLARE_R2_ACCESS_KEY_ID e CLOUDFLARE_R2_SECRET_ACCESS_KEY vieram do mesmo token R2, '
      + 'sem aspas ou espacos, e que o ACCOUNT_ID/ENDPOINT pertence a mesma conta.'
    );
  }

  if (codigo === 'InvalidAccessKeyId' || codigo === 'Unauthorized') {
    return new Error(
      'Credencial do Cloudflare R2 invalida. Confira o Access Key ID ou crie um novo token R2.'
    );
  }

  if (codigo === 'AccessDenied') {
    return new Error(
      'O token do Cloudflare R2 nao tem permissao de gravacao nesse bucket. Use Object Read & Write.'
    );
  }

  if (codigo === 'NoSuchBucket') {
    return new Error(
      'Bucket do Cloudflare R2 nao encontrado. Confira CLOUDFLARE_R2_BUCKET e a conta do endpoint.'
    );
  }

  return error;
}

async function uploadImagem(file, metadata = {}) {
  const config = getConfig();
  validarConfiguracao(config);

  if (!file || !file.buffer) {
    throw new Error('Arquivo de imagem nao recebido.');
  }

  const key = montarChaveArquivo(file, metadata);
  const client = getClient(config);

  try {
    await client.send(new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: file.buffer,
      ContentLength: Number(file.size || file.buffer.length),
      ContentType: file.mimetype || 'application/octet-stream',
      // Metadados assinados ficam restritos a valores ASCII simples.
      // O nome do produto nao e necessario para recuperar ou excluir o arquivo.
      Metadata: {
        produto_id: normalizarParteChave(metadata.produto_id || ''),
        posicao: normalizarParteChave(metadata.posicao || ''),
      },
    }));
  } catch (error) {
    console.error('[Cloudflare R2] Falha no upload:', {
      codigo: extrairCodigoErro(error),
      statusHttp: error?.$metadata?.httpStatusCode || null,
      requestId: error?.$metadata?.requestId || null,
      endpoint: config.endpoint,
      bucket: config.bucket,
      accessKeyLength: config.accessKeyId.length,
      secretKeyLength: config.secretAccessKey.length,
    });

    throw traduzirErroR2(error);
  }

  return {
    id: key,
    key,
    filename: file.originalname || null,
    url: montarUrlPublica(config.publicUrl, key),
    tamanhoMbLimite: MAX_UPLOAD_SIZE_MB,
  };
}


async function uploadBuffer(buffer, options = {}) {
  const config = getConfig();
  validarConfiguracao(config);
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new Error('Buffer vazio para upload no R2.');

  const pasta = normalizarParteChave(options.pasta || 'arquivos');
  const nomeInformado = String(options.nome || `arquivo-${Date.now()}`).trim();
  const ext = path.extname(nomeInformado).replace(/^\./, '').toLowerCase() || 'bin';
  const base = normalizarParteChave(path.basename(nomeInformado, path.extname(nomeInformado)));
  const key = `${pasta}/${base}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
  const client = getClient(config);

  await client.send(new PutObjectCommand({
    Bucket: config.bucket,
    Key: key,
    Body: buffer,
    ContentLength: buffer.length,
    ContentType: options.contentType || 'application/octet-stream',
    Metadata: Object.fromEntries(Object.entries(options.metadata || {}).map(([k,v]) => [normalizarParteChave(k), normalizarParteChave(v)])),
  }));

  return { id:key, key, url:montarUrlPublica(config.publicUrl,key) };
}

module.exports = {
  uploadImagem,
  uploadBuffer,
  MAX_UPLOAD_SIZE_MB,
};
