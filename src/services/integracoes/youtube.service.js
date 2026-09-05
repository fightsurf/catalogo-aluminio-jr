const fs = require('fs');
const fsp = require('fs/promises');
const https = require('https');

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const UPLOAD_URL = 'https://www.googleapis.com/upload/youtube/v3/videos';

function valor(valor) {
  let texto = String(valor ?? '').trim();
  if (texto.length >= 2 && ((texto.startsWith('"') && texto.endsWith('"')) || (texto.startsWith("'") && texto.endsWith("'")))) {
    texto = texto.slice(1, -1).trim();
  }
  return texto;
}

function getConfig() {
  return {
    clientId: valor(process.env.YOUTUBE_CLIENT_ID || process.env.YOUTUBE_OAUTH_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || ''),
    clientSecret: valor(process.env.YOUTUBE_CLIENT_SECRET || process.env.YOUTUBE_OAUTH_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET || ''),
    refreshToken: valor(process.env.YOUTUBE_REFRESH_TOKEN || process.env.YOUTUBE_OAUTH_REFRESH_TOKEN || process.env.GOOGLE_REFRESH_TOKEN || ''),
    privacyStatus: valor(process.env.YOUTUBE_PRIVACY_STATUS || 'public').toLowerCase(),
    categoryId: valor(process.env.YOUTUBE_CATEGORY_ID || '22'),
  };
}

function diagnosticarConfiguracao() {
  const config = getConfig();
  const faltando = [];
  if (!config.clientId) faltando.push('YOUTUBE_CLIENT_ID');
  if (!config.clientSecret) faltando.push('YOUTUBE_CLIENT_SECRET');
  if (!config.refreshToken) faltando.push('YOUTUBE_REFRESH_TOKEN');
  return { configurado: faltando.length === 0, faltando, privacy_status: config.privacyStatus };
}

function validarConfig(config) {
  const diag = diagnosticarConfiguracao();
  if (!diag.configurado) throw new Error(`YouTube não configurado. Configure: ${diag.faltando.join(', ')}.`);
  if (!['public', 'private', 'unlisted'].includes(config.privacyStatus)) {
    throw new Error('YOUTUBE_PRIVACY_STATUS inválido. Use public, private ou unlisted.');
  }
  return config;
}

async function lerJson(response, contexto) {
  const texto = await response.text().catch(() => '');
  let data = {};
  if (texto) {
    try { data = JSON.parse(texto); } catch (_) { data = { raw: texto }; }
  }
  if (!response.ok) {
    const detalhe = data?.error?.message || data?.error_description || data?.message || texto || 'erro não informado';
    throw new Error(`${contexto} respondeu ${response.status}: ${detalhe}`);
  }
  return data;
}

async function obterAccessToken(config) {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: config.refreshToken,
    grant_type: 'refresh_token',
  });

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await lerJson(response, 'OAuth do Google');
  if (!data.access_token) throw new Error('OAuth do Google não retornou access_token.');
  return String(data.access_token);
}

async function iniciarUpload({ accessToken, metadata, tamanho }) {
  const url = new URL(UPLOAD_URL);
  url.searchParams.set('uploadType', 'resumable');
  url.searchParams.set('part', 'snippet,status');

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Length': String(tamanho),
      'X-Upload-Content-Type': 'video/mp4',
    },
    body: JSON.stringify(metadata),
  });

  if (!response.ok) await lerJson(response, 'YouTube Data API');
  const location = response.headers.get('location');
  if (!location) throw new Error('YouTube não retornou a URL da sessão de upload.');
  return location;
}

function enviarArquivo({ uploadUrl, accessToken, caminho, tamanho }) {
  return new Promise((resolve, reject) => {
    const url = new URL(uploadUrl);
    const req = https.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || 443,
      path: `${url.pathname}${url.search}`,
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'video/mp4',
        'Content-Length': tamanho,
      },
    }, res => {
      let texto = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { texto += chunk; });
      res.on('end', () => {
        let data = {};
        if (texto) {
          try { data = JSON.parse(texto); } catch (_) { data = { raw: texto }; }
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          const detalhe = data?.error?.message || texto || 'erro não informado';
          return reject(new Error(`YouTube upload respondeu ${res.statusCode}: ${detalhe}`));
        }
        return resolve(data);
      });
    });

    req.on('error', error => reject(new Error(`Falha no upload para o YouTube: ${error.message}`)));
    const stream = fs.createReadStream(caminho);
    stream.on('error', error => req.destroy(error));
    stream.pipe(req);
  });
}

async function publicarShort({ caminho, titulo, descricao, tags = [] }) {
  const config = validarConfig(getConfig());
  const stat = await fsp.stat(caminho);
  if (!stat.isFile() || stat.size <= 0) throw new Error('Arquivo final do YouTube inválido.');

  const accessToken = await obterAccessToken(config);
  const metadata = {
    snippet: {
      title: String(titulo || 'Alumínio JR #Shorts').slice(0, 100),
      description: String(descricao || '').slice(0, 5000),
      categoryId: config.categoryId,
      tags: Array.from(new Set(['Shorts', 'Alumínio JR', ...tags.map(String)])).slice(0, 30),
    },
    status: {
      privacyStatus: config.privacyStatus,
      selfDeclaredMadeForKids: false,
    },
  };

  const uploadUrl = await iniciarUpload({ accessToken, metadata, tamanho: stat.size });
  const data = await enviarArquivo({ uploadUrl, accessToken, caminho, tamanho: stat.size });
  if (!data.id) throw new Error('YouTube não retornou o ID do vídeo publicado.');

  return {
    success: true,
    status: 'publicado',
    video_id: String(data.id),
    url: `https://www.youtube.com/shorts/${data.id}`,
    privacy_status: data?.status?.privacyStatus || config.privacyStatus,
  };
}

module.exports = {
  diagnosticarConfiguracao,
  publicarShort,
};
