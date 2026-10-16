'use strict';
// Exclusão isolada. NÃO alterar a proteção 'ofertas/' do serviço R2 existente.
const { S3Client, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const service = require('../cloudflare/cloudflareR2.service');
const PREFIXO = 'republicador-youtube/';

function env(name) {
  let v=String(process.env[name] || '').trim();
  if ((v.startsWith('\"') && v.endsWith('\"')) || (v.startsWith("'") && v.endsWith("'"))) v=v.slice(1,-1).trim();
  return v;
}
function config() {
  const account = env('CLOUDFLARE_R2_ACCOUNT_ID') || env('CLOUDFLARE_ACCOUNT_ID');
  const endpoint = env('CLOUDFLARE_R2_ENDPOINT') || `https://${account}.r2.cloudflarestorage.com`;
  const bucket = env('CLOUDFLARE_R2_BUCKET');
  if (!account || !bucket || !env('CLOUDFLARE_R2_ACCESS_KEY_ID') || !env('CLOUDFLARE_R2_SECRET_ACCESS_KEY')) {
    throw new Error('Credenciais Cloudflare R2 incompletas.');
  }
  const url = new URL(endpoint);
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.r2.cloudflarestorage.com')) {
    throw new Error('Endpoint R2 inválido.');
  }
  return { endpoint, bucket, accessKeyId: env('CLOUDFLARE_R2_ACCESS_KEY_ID'),
    secretAccessKey: env('CLOUDFLARE_R2_SECRET_ACCESS_KEY') };
}

async function excluir(key) {
  if (typeof key !== 'string' || !/^republicador-youtube\/[a-z0-9][a-z0-9._-]{1,190}\.mp4$/.test(key)) {
    throw new Error('Exclusão recusada: chave não pertence ao republicador.');
  }
  const c = config();
  const client = new S3Client({ region: 'auto', endpoint: c.endpoint,
    credentials: { accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey } });
  try { await client.send(new DeleteObjectCommand({ Bucket: c.bucket, Key: key })); }
  finally { client.destroy(); }
}

async function upload(caminho, nome, id, parte) {
  return service.uploadArquivoLocal(caminho, {
    pasta: 'republicador-youtube', nome,
    contentType: 'video/mp4', metadata: { origem: 'youtube', job: id, parte: String(parte) },
  });
}

module.exports = { excluir, upload, PREFIXO };
