'use strict';

// Catalogo publico do canal: usa somente YouTube Data API Key.
// O OAuth configurado para enviar Shorts pode conter exclusivamente youtube.upload
// e NAO deve ser utilizado para consultar channels.list(mine=true).
// Nao modifica os servicos de publicacao existentes.
const API = 'https://www.googleapis.com/youtube/v3';

function env(...names) {
  for (const name of names) {
    const value = String(process.env[name] || '').trim().replace(/^(["'])(.*)\1$/, '$2');
    if (value) return value;
  }
  return '';
}

function chaveApi() {
  const key = env('YOUTUBE_API_KEY');
  if (!key) {
    throw new Error(
      'Configure YOUTUBE_API_KEY no ambiente do Render (chave da YouTube Data API v3). ' +
      'O YOUTUBE_REFRESH_TOKEN usado para publicar Shorts nao substitui essa chave.'
    );
  }
  return key;
}

async function json(response, origem) {
  const raw = await response.text();
  let data;
  try { data = JSON.parse(raw); } catch (_) { data = {}; }
  if (!response.ok) {
    const detalhe = data?.error?.message || data?.error_description || raw.slice(0, 300) || 'erro nao informado';
    if (response.status === 403 && /(?:insufficient authentication scopes|insufficientpermissions)/i.test(detalhe)) {
      throw new Error('A leitura publica do canal deve usar YOUTUBE_API_KEY, nao OAuth de upload. ' + origem + ': ' + detalhe);
    }
    throw new Error(`${origem} (${response.status}): ${detalhe}`);
  }
  return data;
}

async function getYoutube(resource, params = {}) {
  const key = chaveApi();
  const url = new URL(`${API}/${resource}`);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  });
  url.searchParams.set('key', key);
  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(25000) });
  } catch (e) {
    throw new Error(`Nao foi possivel consultar o YouTube Data API: ${e.message}`);
  }
  return json(response, 'YouTube Data API');
}

function obterIdentificacaoCanal() {
  const id = env('YOUTUBE_CHANNEL_ID');
  if (id) {
    // Aceita o ID bruto ou uma URL https://www.youtube.com/channel/UC...
    const match = id.match(/^(?:https?:\/\/(?:www\.)?youtube\.com\/channel\/)?(UC[A-Za-z0-9_-]{22})(?:\/?(?:\?.*)?)?$/i);
    if (!match) throw new Error('YOUTUBE_CHANNEL_ID invalido. Informe o ID UC... do canal, nao o nome.');
    return { id: match[1] };
  }
  const rawHandle = env('YOUTUBE_CHANNEL_HANDLE');
  if (rawHandle) {
    const handle = rawHandle.replace(/^https?:\/\/(?:www\.)?youtube\.com\//i, '').replace(/^@/, '').replace(/^\//, '').replace(/\/$/, '');
    if (!/^[A-Za-z0-9._-]{3,40}$/.test(handle)) {
      throw new Error('YOUTUBE_CHANNEL_HANDLE invalido. Use @NomeDoCanal ou o identificador do canal.');
    }
    return { handle: `@${handle}` };
  }
  throw new Error(
    'Configure YOUTUBE_CHANNEL_ID (comecando em UC...) ou YOUTUBE_CHANNEL_HANDLE ' +
    '(por exemplo, @NomeDoCanal) no Render. Nao precisamos alterar o OAuth dos Shorts.'
  );
}

async function canal() {
  // Nunca chama channels.list(mine=true) com o token de upload existente.
  const ident = obterIdentificacaoCanal();
  if (ident.id) return ident.id;
  const data = await getYoutube('channels', { part: 'id', forHandle: ident.handle });
  const id = data.items?.[0]?.id;
  if (!id) throw new Error(`Canal ${ident.handle} nao encontrado. Verifique YOUTUBE_CHANNEL_HANDLE.`);
  return id;
}

async function uploadsPlaylist(channelId) {
  const data = await getYoutube('channels', { part: 'contentDetails,snippet', id: channelId });
  const item = data.items?.[0];
  if (!item) throw new Error('Canal do YouTube nao encontrado. Confira o ID ou handle configurado.');
  return { playlist: item.contentDetails?.relatedPlaylists?.uploads, canal: item.snippet?.title || channelId };
}

async function listar(pageToken = '') {
  if (pageToken && !/^[A-Za-z0-9_=-]{1,500}$/.test(pageToken)) throw new Error('Pagina invalida.');
  const channelId = await canal();
  const { playlist, canal: nomeCanal } = await uploadsPlaylist(channelId);
  if (!playlist) throw new Error('YouTube nao retornou a playlist de uploads do canal.');
  const data = await getYoutube('playlistItems', {
    part: 'snippet,contentDetails', playlistId: playlist, maxResults: '50', pageToken,
  });
  const ids = (data.items || []).map(x => x.contentDetails?.videoId).filter(Boolean);
  let duracoes = {};
  if (ids.length) {
    const details = await getYoutube('videos', { part: 'contentDetails', id: ids.join(',') });
    duracoes = Object.fromEntries((details.items || []).map(x => [x.id, x.contentDetails?.duration || '']));
  }
  return {
    canal: nomeCanal, channel_id: channelId, proxima_pagina: data.nextPageToken || null,
    videos: (data.items || []).filter(x => ids.includes(x.contentDetails?.videoId)).map(x => ({
      id: x.contentDetails.videoId,
      titulo: x.snippet?.title || 'Sem titulo',
      descricao: (x.snippet?.description || '').slice(0, 2000),
      data: x.contentDetails?.videoPublishedAt || x.snippet?.publishedAt,
      miniatura: x.snippet?.thumbnails?.medium?.url || x.snippet?.thumbnails?.default?.url || '',
      duracao_iso: duracoes[x.contentDetails.videoId] || '',
      url: `https://www.youtube.com/watch?v=${x.contentDetails.videoId}`,
    })),
  };
}

async function validarVideoProprio(videoId) {
  if (!/^[A-Za-z0-9_-]{11}$/.test(String(videoId || ''))) throw new Error('ID de video invalido.');
  const channelId = await canal();
  const data = await getYoutube('videos', { part: 'snippet,contentDetails', id: videoId });
  const item = data.items?.[0];
  if (!item || item.snippet?.channelId !== channelId) {
    throw new Error('Video nao encontrado entre os videos publicos do canal configurado da Aluminio JR.');
  }
  return { id: videoId, titulo: item.snippet?.title || 'Video Aluminio JR',
    descricao: item.snippet?.description || '', duracao_iso: item.contentDetails?.duration || '' };
}

module.exports = { listar, validarVideoProprio, canal };
