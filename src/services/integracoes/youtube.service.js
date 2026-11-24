const fs = require('fs');
const fsp = require('fs/promises');
const https = require('https');
const crypto = require('crypto');

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const UPLOAD_URL = 'https://www.googleapis.com/upload/youtube/v3/videos';
const TEMPO_REQUISICAO_MS = 60 * 1000;
const TEMPO_UPLOAD_MS = 10 * 60 * 1000;

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

function identificarCanal() {
  const canal = valor(process.env.YOUTUBE_CHANNEL_ID).replace(/^https?:\/\/(?:www\.)?youtube\.com\/channel\//i, '').replace(/\/$/, '');
  if (/^UC[A-Za-z0-9_-]{22}$/.test(canal)) return `canal:${canal}`;
  // O escopo youtube.upload não permite consultar channels.list(mine=true).
  // Sem ID configurado, identifica a conexão sem persistir suas credenciais.
  const config = getConfig();
  return `conexao:${crypto.createHash('sha256').update(`${config.clientId}\0${config.refreshToken}`).digest('hex')}`;
}

function limiteUploadAtingido(error) {
  const reasons = Array.isArray(error?.reasons) ? error.reasons : [];
  const reason = error?.reason || error?.error?.errors?.[0]?.reason;
  const estruturados = [...reasons, ...(reason ? [reason] : [])];
  if (estruturados.length) return estruturados.includes('uploadLimitExceeded');
  // Compatibilidade com registros antigos, que guardavam apenas a mensagem.
  return /(?:^|:\s*)The user has exceeded the number of videos they may upload\.?\s*$/i.test(String(error?.message || error || ''));
}

function erroResposta(statusCode, data, texto, contexto, uploadIniciado = false) {
  const detalhe = data?.error?.message || data?.error_description || data?.message || texto || 'erro não informado';
  const error = new Error(`${contexto} respondeu ${statusCode}: ${detalhe}`);
  error.statusCode = Number(statusCode);
  error.reasons = (Array.isArray(data?.error?.errors) ? data.error.errors : []).map(item => item?.reason).filter(Boolean);
  error.reason = error.reasons[0];
  error.uploadIniciado = uploadIniciado;
  error.envioIncerto = uploadIniciado && (error.statusCode >= 500 || error.statusCode === 408 || error.statusCode === 308);
  return error;
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
    throw erroResposta(response.status, data, texto, contexto);
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
    signal: AbortSignal.timeout(TEMPO_REQUISICAO_MS),
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
    signal: AbortSignal.timeout(TEMPO_REQUISICAO_MS),
  });

  if (!response.ok) await lerJson(response, 'YouTube Data API');
  const location = response.headers.get('location');
  if (!location) throw new Error('YouTube não retornou a URL da sessão de upload.');
  return location;
}

function enviarArquivo({ uploadUrl, accessToken, caminho, tamanho }) {
  return new Promise((resolve, reject) => {
    const url = new URL(uploadUrl);
    let stream;
    let req;
    let timer;
    let concluido = false;
    const terminar = (error, data) => {
      if (concluido) return;
      concluido = true;
      clearTimeout(timer);
      if (error) {
        if (stream) stream.destroy();
        if (req) req.destroy();
        reject(error);
      } else resolve(data);
    };
    const falhaTransporte = mensagem => {
      const error = new Error(`Falha no upload para o YouTube: ${mensagem}`);
      error.uploadIniciado = true;
      error.envioIncerto = true;
      return error;
    };
    req = https.request({
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
      res.on('error', error => terminar(falhaTransporte(error.message)));
      res.on('aborted', () => terminar(falhaTransporte('resposta interrompida; confira o canal antes de reenviar.')));
      res.on('end', () => {
        let data = {};
        if (texto) {
          try { data = JSON.parse(texto); } catch (_) { data = { raw: texto }; }
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return terminar(erroResposta(res.statusCode, data, texto, 'YouTube upload', true));
        }
        return terminar(null, data);
      });
    });

    req.on('error', error => terminar(falhaTransporte(error.message)));
    timer = setTimeout(() => req.destroy(new Error('tempo de upload excedido; confira o canal antes de reenviar.')), TEMPO_UPLOAD_MS);
    if (typeof timer.unref === 'function') timer.unref();
    stream = fs.createReadStream(caminho);
    stream.on('error', error => req.destroy(error));
    stream.pipe(req);
  });
}

async function publicarShort({ caminho, titulo, descricao, tags = [] }) {
  let uploadIniciado = false;
  try {
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
    uploadIniciado = true;
    const data = await enviarArquivo({ uploadUrl, accessToken, caminho, tamanho: stat.size });
    if (!data.id) throw new Error('YouTube não retornou o ID do vídeo publicado.');

    return {
      success: true,
      status: 'publicado',
      video_id: String(data.id),
      url: `https://www.youtube.com/shorts/${data.id}`,
      privacy_status: data?.status?.privacyStatus || config.privacyStatus,
    };
  } catch (error) {
    if (error.uploadIniciado === undefined) error.uploadIniciado = uploadIniciado;
    if (error.envioIncerto === undefined) error.envioIncerto = uploadIniciado;
    throw error;
  }
}

module.exports = {
  diagnosticarConfiguracao,
  identificarCanal,
  limiteUploadAtingido,
  publicarShort,
};
