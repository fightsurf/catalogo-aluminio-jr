const fs = require('fs/promises');
const pool = require('../../../db/connection');
const videoOverlayService = require('./videoOverlay.service');
const cloudflareR2Service = require('../cloudflare/cloudflareR2.service');
const zapiService = require('../integracoes/zapi.service');
const instagramService = require('../integracoes/instagram.service');
const facebookService = require('../integracoes/facebook.service');
const youtubeService = require('../integracoes/youtube.service');
const termometroAparicoesService = require('../termometro/termometroAparicoes.service');

const requisicoesEmAndamento = new Map();
const publicacoes = new Map();
const TEMPO_CACHE_MS = 30 * 60 * 1000;
const TEMPO_PUBLICACAO_MS = 2 * 60 * 60 * 1000;
let filaProcessamento = Promise.resolve();

function texto(valor) {
  return String(valor ?? '').trim();
}

function normalizarRequestId(valor) {
  const requestId = texto(valor);
  if (!requestId) throw new Error('Identificador da publicação não informado.');
  if (requestId.length > 120 || !/^[a-zA-Z0-9._:-]+$/.test(requestId)) {
    throw new Error('Identificador da publicação inválido.');
  }
  return requestId;
}

function normalizarQuantidade(valor) {
  const quantidade = Number.parseInt(valor, 10);
  if (!Number.isInteger(quantidade) || quantidade <= 0 || quantidade > 99) {
    throw new Error('Quantidade inválida. Use um valor entre 1 e 99.');
  }
  return quantidade;
}

function parseItens(valor) {
  let lista = valor;
  if (typeof valor === 'string') {
    try { lista = JSON.parse(valor); } catch (_) { throw new Error('Lista de itens inválida.'); }
  }
  if (!Array.isArray(lista) || !lista.length) throw new Error('Selecione pelo menos um item do vídeo.');

  const mapa = new Map();
  for (const item of lista) {
    const produtoId = Number.parseInt(item?.produto_id ?? item?.id, 10);
    if (!Number.isInteger(produtoId) || produtoId <= 0) throw new Error('Há um produto inválido na seleção.');
    const quantidade = normalizarQuantidade(item?.quantidade ?? 1);
    const acumulada = (mapa.get(produtoId) || 0) + quantidade;
    if (acumulada > 99) throw new Error('A quantidade máxima por produto é 99.');
    mapa.set(produtoId, acumulada);
  }

  return Array.from(mapa.entries()).map(([produto_id, quantidade]) => ({ produto_id, quantidade }));
}

function moeda(valor) {
  return Number(valor || 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).replace(/\u00a0/g, ' ');
}

async function carregarItensSelecionados(itensInformados) {
  const ids = itensInformados.map(item => item.produto_id);
  const result = await pool.query(`
    SELECT
      p.id,
      p.nome,
      p.preco,
      p.ativo,
      p.item_legado,
      c.id AS categoria_id,
      c.nome AS categoria
    FROM produtos p
    LEFT JOIN produtos_categorias c ON c.id = p.categoria_id
    WHERE p.id = ANY($1::bigint[])
  `, [ids]);

  const porId = new Map(result.rows.map(row => [Number(row.id), row]));
  return itensInformados.map(item => {
    const produto = porId.get(item.produto_id);
    if (!produto) throw new Error(`Produto ${item.produto_id} não encontrado.`);
    if (produto.ativo !== true) throw new Error(`O produto “${produto.nome}” está inativo.`);

    const preco = Number(produto.preco);
    if (!Number.isFinite(preco) || preco <= 0) throw new Error(`O produto “${produto.nome}” está sem preço válido.`);

    return {
      produto_id: Number(produto.id),
      nome: texto(produto.nome),
      preco,
      quantidade: item.quantidade,
      categoria_id: produto.categoria_id ? Number(produto.categoria_id) : null,
      categoria: produto.categoria || '',
      item_legado: produto.item_legado ? Number(produto.item_legado) : null,
    };
  });
}

function calcularResumo(itens) {
  const quantidadeItens = itens.reduce((soma, item) => soma + Number(item.quantidade || 0), 0);
  const valorTotal = itens.reduce((soma, item) => soma + Number(item.preco || 0) * Number(item.quantidade || 0), 0);
  const precoMedio = quantidadeItens > 0 ? valorTotal / quantidadeItens : 0;
  return {
    quantidade_itens: quantidadeItens,
    valor_total: Number(valorTotal.toFixed(2)),
    preco_medio: Number(precoMedio.toFixed(2)),
  };
}

function montarTextoFacebook(itens, resumo) {
  const linhasItens = itens.map(item => (
    `• ${item.quantidade}x ${item.nome} — ${moeda(resumo.preco_medio)} cada`
  ));

  return [
    'KIT ALUMÍNIO JR',
    '',
    ...linhasItens,
    '',
    `Cada item: ${moeda(resumo.preco_medio)}`,
    `Kit completo: ${moeda(resumo.valor_total)}`,
    `${resumo.quantidade_itens} ${resumo.quantidade_itens === 1 ? 'item' : 'itens'}`,
    '',
    'ZAP: 83.9.9979-2085',
    'Instagram: @aluminiojrpb',
    'George',
  ].join('\n');
}

function montarYoutube(itens, resumo) {
  const rotuloItens = resumo.quantidade_itens === 1 ? 'item' : 'itens';
  const titulo = `Kit Alumínio JR — ${resumo.quantidade_itens} ${rotuloItens} por ${moeda(resumo.valor_total)} #Shorts`;
  const descricao = [
    `Cada item: ${moeda(resumo.preco_medio)}`,
    `Kit completo: ${moeda(resumo.valor_total)}`,
    '',
    'Itens:',
    ...itens.map(item => `• ${item.quantidade}x ${item.nome}`),
    '',
    'ZAP: 83.9.9979-2085',
    'Instagram: @aluminiojrpb',
    '#Shorts #AluminioJR',
  ].join('\n');

  return {
    titulo,
    descricao,
    tags: itens.map(item => item.nome).slice(0, 20),
  };
}

function removerDoCacheDepois(chave) {
  const timer = setTimeout(() => requisicoesEmAndamento.delete(chave), TEMPO_CACHE_MS);
  if (typeof timer.unref === 'function') timer.unref();
}

async function executarCanalIdempotente(chave, executar) {
  const existente = requisicoesEmAndamento.get(chave);
  if (existente) {
    const resultado = await existente;
    return { ...resultado, repetida: true };
  }

  const promessa = Promise.resolve().then(executar);
  requisicoesEmAndamento.set(chave, promessa);
  try {
    const resultado = await promessa;
    removerDoCacheDepois(chave);
    return { ...resultado, repetida: false };
  } catch (error) {
    requisicoesEmAndamento.delete(chave);
    throw error;
  }
}

function limitarErro(error) {
  const mensagem = texto(error?.message || error || 'Erro não informado.');
  return mensagem.length > 900 ? `${mensagem.slice(0, 897)}...` : mensagem;
}

async function executarCanalSeguro(chave, canal, executar) {
  try {
    const resultado = await executarCanalIdempotente(chave, executar);
    return { canal, status: 'publicado', ...resultado };
  } catch (error) {
    return { canal, status: 'erro', erro: limitarErro(error), repetida: false };
  }
}

function memoriaNode() {
  const uso = process.memoryUsage();
  const mb = valor => Math.round((Number(valor || 0) / 1024 / 1024) * 10) / 10;
  return { rss_mb: mb(uso.rss), heap_mb: mb(uso.heapUsed), external_mb: mb(uso.external) };
}

function logMemoria(etapa, requestId) {
  console.log('[Status Vídeos] memória', { request_id: requestId, etapa, ...memoriaNode() });
}

function mb(bytes) {
  return Math.round((Number(bytes || 0) / 1024 / 1024) * 100) / 100;
}

async function publicar({ arquivo, requestId, itens: itensBrutos }) {
  if (!arquivo?.path) throw new Error('Selecione o vídeo antes de publicar.');

  let videoFinal = null;
  let videoWhatsapp = null;

  try {
    const idRequisicao = normalizarRequestId(requestId);
    const itensInformados = parseItens(itensBrutos);
    const itens = await carregarItensSelecionados(itensInformados);
    const resumo = calcularResumo(itens);

    logMemoria('antes_ffmpeg', idRequisicao);
    videoFinal = await videoOverlayService.gerarVideoFinal({
      caminhoEntrada: arquivo.path,
      precoMedio: resumo.preco_medio,
      valorTotal: resumo.valor_total,
      quantidadeItens: resumo.quantidade_itens,
    });
    logMemoria('depois_ffmpeg', idRequisicao);

    const tamanhoOriginalBytes = Number(arquivo.size || 0) || await videoOverlayService.tamanhoArquivoBytes(arquivo.path);
    const tamanhoFinalBytes = await videoOverlayService.tamanhoArquivoBytes(videoFinal.caminho);
    console.log('[Status Vídeos] tamanhos', {
      request_id: idRequisicao,
      original_mb: mb(tamanhoOriginalBytes),
      processado_mb: mb(tamanhoFinalBytes),
      whatsapp_limite_seguro_mb: mb(videoOverlayService.WHATSAPP_LIMITE_SEGURO_BYTES),
    });

    const r2 = await cloudflareR2Service.uploadArquivoLocal(videoFinal.caminho, {
      pasta: 'status-videos',
      nome: `status-video-${idRequisicao}.mp4`,
      contentType: 'video/mp4',
      metadata: { request_id: idRequisicao },
    });

    const textoFacebook = montarTextoFacebook(itens, resumo);
    const youtube = montarYoutube(itens, resumo);

    // Os canais são executados um de cada vez. Como o frontend agora acompanha o job
    // por polling, não há necessidade de concentrar cinco uploads/processamentos ao mesmo
    // tempo dentro da mesma instância do Render.
    const whatsapp = await executarCanalSeguro(`${idRequisicao}:whatsapp-status`, 'whatsapp', async () => {
      videoWhatsapp = await videoOverlayService.gerarVideoWhatsapp({
        caminhoEntrada: videoFinal.caminho,
        duracaoSegundos: videoFinal.duracao_segundos,
      });

      let urlWhatsapp = r2.url;
      if (videoWhatsapp.temporario) {
        const r2Whatsapp = await cloudflareR2Service.uploadArquivoLocal(videoWhatsapp.caminho, {
          pasta: 'status-videos',
          nome: `status-video-${idRequisicao}-whatsapp.mp4`,
          contentType: 'video/mp4',
          metadata: { request_id: idRequisicao, destino: 'whatsapp-status' },
        });
        urlWhatsapp = r2Whatsapp.url;
      }

      console.log('[Status Vídeos] WhatsApp', {
        request_id: idRequisicao,
        recomprimido: videoWhatsapp.recomprimido,
        tamanho_mb: mb(videoWhatsapp.tamanho_bytes),
        bitrate_video_kbps: videoWhatsapp.bitrate_video_kbps || null,
      });

      const r = await zapiService.enviarVideoStatus({ video: urlWhatsapp });
      return {
        zapi: r.zapi || null,
        recomprimido: videoWhatsapp.recomprimido,
        tamanho_mb: mb(videoWhatsapp.tamanho_bytes),
      };
    });

    const instagram = await executarCanalSeguro(`${idRequisicao}:instagram-story`, 'instagram_story', async () => {
      const r = await instagramService.publicarStoryVideo({ videoUrl: r2.url });
      return {
        media_id: r.media_id,
        container_id: r.container_id,
        processamento_status: r.processamento_status,
        api_version: r.api_version,
      };
    });

    const facebookStory = await executarCanalSeguro(`${idRequisicao}:facebook-story`, 'facebook_story', async () => {
      const r = await facebookService.publicarStoryVideo({ videoUrl: r2.url });
      return { post_id: r.post_id, video_id: r.video_id, api_version: r.api_version };
    });

    const facebookFeed = await executarCanalSeguro(`${idRequisicao}:facebook-feed`, 'facebook_feed', async () => {
      const r = await facebookService.publicarFeedVideo({
        videoUrl: r2.url,
        message: textoFacebook,
        title: `Kit Alumínio JR — ${resumo.quantidade_itens} ${resumo.quantidade_itens === 1 ? 'item' : 'itens'}`,
      });
      return { post_id: r.post_id, video_id: r.video_id, api_version: r.api_version };
    });

    const youtubeShorts = await executarCanalSeguro(`${idRequisicao}:youtube-shorts`, 'youtube_shorts', async () => {
      const r = await youtubeService.publicarShort({
        caminho: videoFinal.caminho,
        titulo: youtube.titulo,
        descricao: youtube.descricao,
        tags: youtube.tags,
      });
      return { video_id: r.video_id, url: r.url, privacy_status: r.privacy_status };
    });

    const canais = {
      whatsapp,
      instagram_story: instagram,
      facebook_story: facebookStory,
      facebook_feed: facebookFeed,
      youtube_shorts: youtubeShorts,
    };

    const publicados = Object.values(canais).filter(canal => canal.status === 'publicado').length;
    const totalCanais = Object.keys(canais).length;
    const statusGeral = publicados === totalCanais ? 'publicado' : (publicados > 0 ? 'parcial' : 'erro');

    if (publicados > 0) {
      try {
        await termometroAparicoesService.registrarStatusVideos({
          requestId: idRequisicao,
          itens,
          canais,
        });
      } catch (error) {
        console.error('[Status Vídeos] Falha ao registrar aparições no Termômetro:', error);
      }
    }

    logMemoria('fim_publicacao', idRequisicao);
    return {
      success: statusGeral === 'publicado',
      status_geral: statusGeral,
      request_id: idRequisicao,
      video_url: r2.url,
      video: {
        duracao_segundos: videoFinal.duracao_segundos,
        largura: videoFinal.largura,
        altura: videoFinal.altura,
        fps: videoFinal.fps,
        tamanho_original_mb: mb(tamanhoOriginalBytes),
        tamanho_processado_mb: mb(tamanhoFinalBytes),
        tamanho_whatsapp_mb: videoWhatsapp ? mb(videoWhatsapp.tamanho_bytes) : null,
        whatsapp_recomprimido: Boolean(videoWhatsapp?.recomprimido),
        whatsapp_limite_seguro_mb: mb(videoOverlayService.WHATSAPP_LIMITE_SEGURO_BYTES),
      },
      resumo,
      itens,
      facebook_texto: textoFacebook,
      canais,
    };
  } finally {
    await fs.unlink(arquivo.path).catch(() => {});
    if (videoWhatsapp?.temporario && videoWhatsapp?.caminho) await fs.unlink(videoWhatsapp.caminho).catch(() => {});
    if (videoFinal?.caminho) await fs.unlink(videoFinal.caminho).catch(() => {});
  }
}

function enfileirar(executar) {
  const execucao = filaProcessamento.catch(() => {}).then(executar);
  filaProcessamento = execucao.catch(() => {});
  return execucao;
}

function agendarLimpezaPublicacao(requestId) {
  const timer = setTimeout(() => publicacoes.delete(requestId), TEMPO_PUBLICACAO_MS);
  if (typeof timer.unref === 'function') timer.unref();
}

function serializarPublicacao(job) {
  if (!job) return null;
  return {
    request_id: job.request_id,
    status: job.status,
    criado_em: job.criado_em,
    atualizado_em: job.atualizado_em,
    resultado: job.resultado || null,
    erro: job.erro || null,
  };
}

async function iniciarPublicacao({ arquivo, requestId, itens }) {
  if (!arquivo?.path) throw new Error('Selecione o vídeo antes de publicar.');

  const idRequisicao = normalizarRequestId(requestId);
  const itensNormalizados = parseItens(itens);
  const existente = publicacoes.get(idRequisicao);

  if (existente && ['aguardando', 'processando'].includes(existente.status)) {
    // O navegador pode repetir a requisição se perder a resposta HTTP. Não guardamos
    // uma segunda cópia do mesmo vídeo nem iniciamos outro FFmpeg.
    await fs.unlink(arquivo.path).catch(() => {});
    return serializarPublicacao(existente);
  }

  const agora = new Date().toISOString();
  const job = {
    request_id: idRequisicao,
    status: 'aguardando',
    criado_em: agora,
    atualizado_em: agora,
    resultado: null,
    erro: null,
  };
  publicacoes.set(idRequisicao, job);

  enfileirar(async () => {
    job.status = 'processando';
    job.atualizado_em = new Date().toISOString();
    try {
      const resultado = await publicar({
        arquivo,
        requestId: idRequisicao,
        itens: itensNormalizados,
      });
      job.status = 'concluido';
      job.resultado = resultado;
      job.erro = null;
    } catch (error) {
      job.status = 'erro';
      job.resultado = null;
      job.erro = limitarErro(error);
      // Em caso de falha anterior ao bloco finally de publicar, garante limpeza.
      await fs.unlink(arquivo.path).catch(() => {});
      console.error('[Status Vídeos] Job falhou:', { request_id: idRequisicao, erro: job.erro });
    } finally {
      job.atualizado_em = new Date().toISOString();
      agendarLimpezaPublicacao(idRequisicao);
    }
  }).catch(error => {
    console.error('[Status Vídeos] Falha inesperada na fila:', error);
  });

  return serializarPublicacao(job);
}

function obterPublicacao(requestId) {
  const idRequisicao = normalizarRequestId(requestId);
  return serializarPublicacao(publicacoes.get(idRequisicao));
}

function diagnostico() {
  return {
    youtube: youtubeService.diagnosticarConfiguracao(),
    instagram: instagramService.diagnosticarConfiguracao(),
    facebook: facebookService.diagnosticarConfiguracao(),
    video: {
      duracao_minima_segundos: videoOverlayService.DURACAO_MINIMA_SEGUNDOS,
      duracao_maxima_segundos: videoOverlayService.DURACAO_MAXIMA_SEGUNDOS,
      formato_saida: `${videoOverlayService.LARGURA}x${videoOverlayService.ALTURA}`,
      fps_saida: videoOverlayService.FPS_SAIDA,
      processamento_assincrono: true,
      fila_unica_ffmpeg: true,
      whatsapp_limite_seguro_mb: mb(videoOverlayService.WHATSAPP_LIMITE_SEGURO_BYTES),
      whatsapp_recompressao_automatica: true,
    },
  };
}

module.exports = {
  iniciarPublicacao,
  obterPublicacao,
  publicar,
  diagnostico,
};
