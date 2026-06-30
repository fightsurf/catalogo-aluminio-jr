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

function removerBarraFinal(valor) {
  return String(valor || '').trim().replace(/\/+$/, '');
}

function getConfig() {
  return {
    accountId: process.env.CLOUDFLARE_R2_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID || '',
    accessKeyId: process.env.CLOUDFLARE_R2_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY || '',
    bucket: process.env.CLOUDFLARE_R2_BUCKET || '',
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
}

function getClient(config) {
  const cacheKey = [config.accountId, config.accessKeyId].join('|');

  if (clientCache && clientCacheKey === cacheKey) {
    return clientCache;
  }

  clientCache = new S3Client({
    region: 'auto',
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
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

async function uploadImagem(file, metadata = {}) {
  const config = getConfig();
  validarConfiguracao(config);

  if (!file || !file.buffer) {
    throw new Error('Arquivo de imagem nao recebido.');
  }

  const key = montarChaveArquivo(file, metadata);
  const client = getClient(config);

  await client.send(new PutObjectCommand({
    Bucket: config.bucket,
    Key: key,
    Body: file.buffer,
    ContentType: file.mimetype || 'application/octet-stream',
    Metadata: {
      produto_id: String(metadata.produto_id || ''),
      produto_nome: String(metadata.produto_nome || '').slice(0, 250),
      posicao: String(metadata.posicao || ''),
    },
  }));

  return {
    id: key,
    key,
    filename: file.originalname || null,
    url: montarUrlPublica(config.publicUrl, key),
    tamanhoMbLimite: MAX_UPLOAD_SIZE_MB,
  };
}

module.exports = {
  uploadImagem,
  MAX_UPLOAD_SIZE_MB,
};
