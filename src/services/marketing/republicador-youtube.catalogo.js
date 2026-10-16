'use strict';

const API = 'https://www.googleapis.com/youtube/v3';
const OAUTH = 'https://oauth2.googleapis.com/token';

function env(...names) {
  for (const name of names) {
    const value = String(process.env[name] || '').trim().replace(/^(["'])(.*)\1$/, '$2');
    if (value) return value;
  }
  return '';
}

async function json(response, origem) {
  const raw = await response.text();
  let data;
  try { data = JSON.parse(raw); } catch (_) { data = {}; }
  if (!response.ok) {
    throw new Error(`${origem} (${response.status}): ${data?.error?.message || data?.error_description || raw.slice(0, 300)}`);
  }
  return data;
}

async function token() {
  const clientId = env('YOUTUBE_CLIENT_ID', 'YOUTUBE_OAUTH_CLIENT_ID', 'GOOGLE_CLIENT_ID');
  const clientSecret = env('YOUTUBE_CLIENT_SECRET', 'YOUTUBE_OAUTH_CLIENT_SECRET', 'GOOGLE_CLIENT_SECRET');
  const refreshToken = env('YOUTUBE_REFRESH_TOKEN', 'YOUTUBE_OAUTH_REFRESH_TOKEN', 'GOOGLE_REFRESH_TOKEN');
  if (!clientId || !clientSecret || !refreshToken) return null;
  const data = await json(await fetch(OAUTH, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret,
      refresh_token: refreshToken, grant_type: 'refresh_token' }),
    signal: AbortSignal.timeout(20000),
  }), 'OAuth YouTube');
  return data.access_token;
}

async function getYoutube(resource, params, bearer = null) {
  if (!bearer && !env('YOUTUBE_API_KEY')) bearer = await token();
  const url = new URL(`${API}/${resource}`);
  Object.entries(params).forEach(([k, v]) => { if (v) url.searchParams.set(k, v); });
  if (!bearer && env('YOUTUBE_API_KEY')) url.searchParams.set('key', env('YOUTUBE_API_KEY'));
  if (!bearer && !env('YOUTUBE_API_KEY')) throw new Error('Configure YOUTUBE_API_KEY no Render para listar os vídeos.');
  const res = await fetch(url, { headers: bearer ? { Authorization: `Bearer ${bearer}` } : {},
    signal: AbortSignal.timeout(25000) });
  return json(res, 'YouTube Data API');
}

async function canal() {
  const idConfig = env('YOUTUBE_CHANNEL_ID');
  if (idConfig) {
    if (!/^UC[A-Za-z0-9_-]{22}$/.test(idConfig)) throw new Error('YOUTUBE_CHANNEL_ID inválido.');
    return idConfig;
  }
  let access;
  try { access = await token(); } catch (e) {
    throw new Error(`Falha ao consultar o canal próprio por OAuth: ${e.message}. Alternativa: configure YOUTUBE_CHANNEL_ID.`);
  }
  if (!access) throw new Error('Informe YOUTUBE_CHANNEL_ID ou configure o OAuth YouTube da fábrica.');
  const data = await getYoutube('channels', { part: 'id', mine: 'true', maxResults: '1' }, access);
  if (!data.items?.[0]?.id) throw new Error('OAuth não autorizou a leitura do canal. Configure YOUTUBE_CHANNEL_ID e YOUTUBE_API_KEY.');
  return data.items[0].id;
}

async function uploadsPlaylist(channelId) {
  const data = await getYoutube('channels', { part: 'contentDetails,snippet', id: channelId });
  const item = data.items?.[0];
  if (!item) throw new Error('Canal do YouTube não encontrado.');
  return { playlist: item.contentDetails?.relatedPlaylists?.uploads, canal: item.snippet?.title || channelId };
}

async function listar(pageToken = '') {
  if (pageToken && !/^[A-Za-z0-9_=-]{1,500}$/.test(pageToken)) throw new Error('Página inválida.');
  const channelId = await canal();
  const { playlist, canal: nomeCanal } = await uploadsPlaylist(channelId);
  if (!playlist) throw new Error('YouTube não retornou a playlist de uploads do canal.');
  const data = await getYoutube('playlistItems', {
    part: 'snippet,contentDetails', playlistId: playlist, maxResults: '50', pageToken,
  });
  const ids = (data.items || []).map(x => x.contentDetails?.videoId).filter(Boolean);
  let duracoes = {};
  if (ids.length) {
    const details = await getYoutube('videos', { part: 'contentDetails,status', id: ids.join(',') });
    duracoes = Object.fromEntries((details.items || []).map(x => [x.id, x.contentDetails?.duration || '']));
  }
  return {
    canal: nomeCanal, channel_id: channelId, proxima_pagina: data.nextPageToken || null,
    videos: (data.items || []).filter(x => ids.includes(x.contentDetails?.videoId)).map(x => ({
      id: x.contentDetails.videoId,
      titulo: x.snippet?.title || 'Sem título',
      descricao: (x.snippet?.description || '').slice(0, 2000),
      data: x.contentDetails?.videoPublishedAt || x.snippet?.publishedAt,
      miniatura: x.snippet?.thumbnails?.medium?.url || x.snippet?.thumbnails?.default?.url || '',
      duracao_iso: duracoes[x.contentDetails.videoId] || '',
      url: `https://www.youtube.com/watch?v=${x.contentDetails.videoId}`,
    })),
  };
}

async function validarVideoProprio(videoId) {
  if (!/^[A-Za-z0-9_-]{11}$/.test(String(videoId || ''))) throw new Error('ID de vídeo inválido.');
  const channelId = await canal();
  const data = await getYoutube('videos', { part: 'snippet,contentDetails', id: videoId });
  const item = data.items?.[0];
  if (!item || item.snippet?.channelId !== channelId) {
    throw new Error('Vídeo não encontrado no canal configurado da Alumínio JR.');
  }
  return { id: videoId, titulo: item.snippet?.title || 'Vídeo Alumínio JR',
    descricao: item.snippet?.description || '', duracao_iso: item.contentDetails?.duration || '' };
}

module.exports = { listar, validarVideoProprio, canal };
