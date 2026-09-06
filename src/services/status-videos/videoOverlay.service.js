const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const sharp = require('sharp');

// 720x1280 preserva o formato vertical 9:16 e reduz fortemente o pico de memória
// do FFmpeg em instâncias Render menores. Stories/Status/Shorts aceitam esse formato.
const LARGURA = 720;
const ALTURA = 1280;
const FPS_SAIDA = 30;
const DURACAO_MINIMA_SEGUNDOS = 3;
const DURACAO_MAXIMA_SEGUNDOS = 55;
const TOPO_DESLOCAMENTO_BASE_Y = 96;

// A Z-API rejeita Status de vídeo acima de 10 MB. Trabalhamos com margem
// para não depender da interpretação decimal/binária do limite do provedor.
const WHATSAPP_LIMITE_SEGURO_BYTES = 9_500_000;
const WHATSAPP_ALVO_BYTES = 8_800_000;
const WHATSAPP_AUDIO_BITRATE = 64_000;

const BASE_LARGURA = 1080;
const BASE_ALTURA = 1920;
const ESCALA_X = LARGURA / BASE_LARGURA;
const ESCALA_Y = ALTURA / BASE_ALTURA;
const ESCALA_FONTE = Math.min(ESCALA_X, ESCALA_Y);

function ffmpegPath() {
  const configurado = String(process.env.FFMPEG_PATH || '').trim();
  if (configurado) return configurado;

  try {
    const binario = require('ffmpeg-static');
    if (binario) return binario;
  } catch (_) {
    // Cai na mensagem padronizada abaixo.
  }
  throw new Error('FFmpeg não encontrado. Instale a dependência ffmpeg-static ou configure FFMPEG_PATH.');
}

function pxX(valor) {
  return Math.round(Number(valor || 0) * ESCALA_X);
}

function pxY(valor) {
  return Math.round(Number(valor || 0) * ESCALA_Y);
}

function pxFonte(valor) {
  return Math.max(14, Math.round(Number(valor || 0) * ESCALA_FONTE));
}

function escaparXml(valor) {
  return String(valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function moeda(valor) {
  return Number(valor || 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).replace(/\u00a0/g, ' ');
}

function estimarLargura(texto, tamanhoFonte, paddingX = pxX(24)) {
  const caracteres = Array.from(String(texto || '')).length;
  return Math.min(
    LARGURA - pxX(96),
    Math.max(pxX(180), Math.ceil(caracteres * tamanhoFonte * 0.56 + paddingX * 2))
  );
}

function linhaSvg({ texto, x, y, tamanhoFonte = pxFonte(48), centralizarEm = null, peso = 500 }) {
  const altura = Math.ceil(tamanhoFonte * 1.48);
  const largura = estimarLargura(texto, tamanhoFonte);
  const posX = centralizarEm === null ? x : Math.round(centralizarEm - largura / 2);
  const baseline = Math.round(y + altura * 0.68);
  const raio = Math.max(8, pxX(18));

  return {
    largura,
    altura,
    x: posX,
    svg: `
      <rect x="${posX}" y="${y}" width="${largura}" height="${altura}" rx="${raio}" ry="${raio}"
            fill="rgba(255,255,255,0.95)"/>
      <text x="${Math.round(posX + largura / 2)}" y="${baseline}" text-anchor="middle"
            font-family="Arial, Helvetica, sans-serif" font-size="${tamanhoFonte}" font-weight="${peso}"
            fill="#111111">${escaparXml(texto)}</text>`
  };
}

function montarSvg({ precoMedio, valorTotal, quantidadeItens }) {
  const zap = 'ZAP: 83.9.9979-2085';
  const instagram = 'Instagram: @aluminiojrpb';
  const nome = 'George';
  const cadaItem = `Cada item: ${moeda(precoMedio)}`;
  const kit = `Kit completo: ${moeda(valorTotal)}`;
  const itens = `${quantidadeItens} ${quantidadeItens === 1 ? 'item' : 'itens'}`;

  const margemX = pxX(54);
  // Desce o bloco superior para não colidir com a foto/ícone do perfil
  // exibido pelas redes sociais na área superior do Story/Status.
  const topo1 = linhaSvg({ texto: zap, x: margemX, y: pxY(82 + TOPO_DESLOCAMENTO_BASE_Y), tamanhoFonte: pxFonte(48) });
  const topo2 = linhaSvg({ texto: instagram, x: margemX, y: pxY(160 + TOPO_DESLOCAMENTO_BASE_Y), tamanhoFonte: pxFonte(48) });
  const larguraTopo = Math.max(topo1.largura, topo2.largura);
  const centroTopo = margemX + larguraTopo / 2;
  const topo3 = linhaSvg({ texto: nome, x: margemX, y: pxY(238 + TOPO_DESLOCAMENTO_BASE_Y), tamanhoFonte: pxFonte(48), centralizarEm: centroTopo, peso: 600 });

  const centroVideo = LARGURA / 2;
  const baixo1 = linhaSvg({ texto: cadaItem, x: 0, y: pxY(1320), tamanhoFonte: pxFonte(52), centralizarEm: centroVideo });
  const baixo2 = linhaSvg({ texto: kit, x: 0, y: pxY(1404), tamanhoFonte: pxFonte(52), centralizarEm: centroVideo });
  const baixo3 = linhaSvg({ texto: itens, x: 0, y: pxY(1488), tamanhoFonte: pxFonte(52), centralizarEm: centroVideo, peso: 600 });

  return `
    <svg width="${LARGURA}" height="${ALTURA}" viewBox="0 0 ${LARGURA} ${ALTURA}"
         xmlns="http://www.w3.org/2000/svg">
      ${topo1.svg}
      ${topo2.svg}
      ${topo3.svg}
      ${baixo1.svg}
      ${baixo2.svg}
      ${baixo3.svg}
    </svg>`;
}

async function criarOverlayPng(dados) {
  const arquivo = path.join(os.tmpdir(), `status-video-overlay-${Date.now()}-${crypto.randomBytes(6).toString('hex')}.png`);
  const svg = montarSvg(dados);
  await sharp(Buffer.from(svg), { density: 72 })
    .png({ compressionLevel: 9, palette: true })
    .toFile(arquivo);
  return arquivo;
}

function executarFfmpeg(args, { aceitarFalha = false } = {}) {
  return new Promise((resolve, reject) => {
    const processo = spawn(ffmpegPath(), args, {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';

    processo.stderr.on('data', chunk => {
      stderr += chunk.toString();
      if (stderr.length > 40000) stderr = stderr.slice(-40000);
    });

    processo.on('error', error => reject(new Error(`Não foi possível executar FFmpeg: ${error.message}`)));
    processo.on('close', codigo => {
      if (codigo === 0 || aceitarFalha) return resolve({ codigo, stderr });
      const detalhe = stderr.split('\n').slice(-12).join('\n').trim();
      return reject(new Error(`FFmpeg não conseguiu processar o vídeo.${detalhe ? ` ${detalhe}` : ''}`));
    });
  });
}

async function obterDuracaoSegundos(caminhoVideo) {
  const { stderr } = await executarFfmpeg(['-hide_banner', '-threads', '1', '-i', caminhoVideo], { aceitarFalha: true });
  const match = stderr.match(/Duration:\s*(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/i);
  if (!match) throw new Error('Não foi possível identificar a duração do vídeo.');
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}


async function tamanhoArquivoBytes(caminho) {
  const stat = await fs.stat(caminho);
  return Number(stat.size || 0);
}

function bitrateWhatsappKbps(duracaoSegundos, fator = 1) {
  const duracao = Math.max(1, Number(duracaoSegundos || 0));
  // Reserva 2% para container/metadata. O áudio entra separado na conta.
  const totalBitsDisponiveis = WHATSAPP_ALVO_BYTES * 8 * 0.98;
  const videoBps = Math.floor((totalBitsDisponiveis / duracao - WHATSAPP_AUDIO_BITRATE) * fator);
  // Limites práticos para 720x1280. Vídeos curtos não precisam de bitrate enorme.
  return Math.max(250, Math.min(3200, Math.floor(videoBps / 1000)));
}

async function gerarVideoWhatsapp({ caminhoEntrada, duracaoSegundos }) {
  if (!caminhoEntrada) throw new Error('Vídeo de entrada do WhatsApp não informado.');

  const tamanhoEntrada = await tamanhoArquivoBytes(caminhoEntrada);
  if (tamanhoEntrada <= WHATSAPP_LIMITE_SEGURO_BYTES) {
    return {
      caminho: caminhoEntrada,
      temporario: false,
      recomprimido: false,
      tamanho_bytes: tamanhoEntrada,
      limite_seguro_bytes: WHATSAPP_LIMITE_SEGURO_BYTES,
    };
  }

  let fator = 1;
  let ultimaSaida = null;

  for (let tentativa = 1; tentativa <= 3; tentativa += 1) {
    const saida = path.join(os.tmpdir(), `status-video-whatsapp-${Date.now()}-${crypto.randomBytes(6).toString('hex')}.mp4`);
    ultimaSaida = saida;
    const bitrateK = bitrateWhatsappKbps(duracaoSegundos, fator);

    await executarFfmpeg([
      '-y',
      '-threads', '1',
      '-i', caminhoEntrada,
      '-map', '0:v:0',
      '-map', '0:a?',
      '-map_metadata', '-1',
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-tune', 'zerolatency',
      '-threads', '1',
      '-refs', '1',
      '-bf', '0',
      '-b:v', `${bitrateK}k`,
      '-maxrate', `${bitrateK}k`,
      '-bufsize', `${bitrateK * 2}k`,
      '-pix_fmt', 'yuv420p',
      '-profile:v', 'high',
      '-level', '4.0',
      '-c:a', 'aac',
      '-b:a', '64k',
      '-ar', '44100',
      '-movflags', '+faststart',
      // Se o bruto ultrapassar 55 s, o próprio FFmpeg encerra a saída em 55 s.
      // Vídeos menores mantêm integralmente a duração original.
      '-t', duracaoSaida.toFixed(3),
      '-shortest',
      saida,
    ]);

    const tamanho = await tamanhoArquivoBytes(saida);
    if (tamanho <= WHATSAPP_LIMITE_SEGURO_BYTES) {
      return {
        caminho: saida,
        temporario: true,
        recomprimido: true,
        tamanho_bytes: tamanho,
        tamanho_original_bytes: tamanhoEntrada,
        bitrate_video_kbps: bitrateK,
        limite_seguro_bytes: WHATSAPP_LIMITE_SEGURO_BYTES,
      };
    }

    await fs.unlink(saida).catch(() => {});
    ultimaSaida = null;

    // Ajuste proporcional usando o tamanho realmente obtido, com folga adicional.
    const proporcao = WHATSAPP_ALVO_BYTES / Math.max(1, tamanho);
    fator = Math.max(0.35, fator * proporcao * 0.92);
  }

  if (ultimaSaida) await fs.unlink(ultimaSaida).catch(() => {});
  throw new Error('Não foi possível reduzir o vídeo para o limite seguro do WhatsApp Status.');
}

async function gerarVideoFinal({ caminhoEntrada, precoMedio, valorTotal, quantidadeItens }) {
  if (!caminhoEntrada) throw new Error('Vídeo de entrada não informado.');

  const duracao = await obterDuracaoSegundos(caminhoEntrada);
  if (duracao < DURACAO_MINIMA_SEGUNDOS) {
    throw new Error(`O vídeo precisa ter pelo menos ${DURACAO_MINIMA_SEGUNDOS} segundos para publicação nos Stories.`);
  }
  const duracaoSaida = Math.min(duracao, DURACAO_MAXIMA_SEGUNDOS);
  const cortadoAutomaticamente = duracao > DURACAO_MAXIMA_SEGUNDOS + 0.05;

  const overlay = await criarOverlayPng({ precoMedio, valorTotal, quantidadeItens });
  const saida = path.join(os.tmpdir(), `status-video-final-${Date.now()}-${crypto.randomBytes(6).toString('hex')}.mp4`);

  try {
    await executarFfmpeg([
      '-y',
      // Limita também o decoder do vídeo de entrada a uma thread.
      '-threads', '1',
      '-i', caminhoEntrada,
      '-loop', '1', '-i', overlay,
      '-filter_threads', '1',
      '-filter_complex_threads', '1',
      '-filter_complex',
      `[0:v]scale=${LARGURA}:${ALTURA}:force_original_aspect_ratio=decrease:flags=fast_bilinear,` +
      `pad=${LARGURA}:${ALTURA}:(ow-iw)/2:(oh-ih)/2:black,fps=${FPS_SAIDA},setsar=1[base];` +
      `[base][1:v]overlay=0:0:shortest=1[outv]`,
      '-map', '[outv]',
      '-map', '0:a?',
      '-map_metadata', '-1',
      '-c:v', 'libx264',
      // Configuração deliberadamente econômica em RAM. Em teste equivalente, o pico do
      // processo FFmpeg caiu de ~700 MB para cerca de ~220 MB.
      '-preset', 'ultrafast',
      '-tune', 'zerolatency',
      '-threads', '1',
      '-refs', '1',
      '-bf', '0',
      '-crf', '23',
      '-maxrate', '3500k',
      '-bufsize', '7000k',
      '-pix_fmt', 'yuv420p',
      '-profile:v', 'high',
      '-level', '4.0',
      '-c:a', 'aac',
      '-b:a', '96k',
      '-ar', '44100',
      '-movflags', '+faststart',
      // Se o bruto ultrapassar 55 s, o próprio FFmpeg encerra a saída em 55 s.
      // Vídeos menores mantêm integralmente a duração original.
      '-t', duracaoSaida.toFixed(3),
      '-shortest',
      saida,
    ]);
  } finally {
    await fs.unlink(overlay).catch(() => {});
  }

  return {
    caminho: saida,
    duracao_segundos: Number(duracaoSaida.toFixed(2)),
    duracao_original_segundos: Number(duracao.toFixed(2)),
    cortado_automaticamente: cortadoAutomaticamente,
    largura: LARGURA,
    altura: ALTURA,
    fps: FPS_SAIDA,
  };
}

module.exports = {
  gerarVideoFinal,
  gerarVideoWhatsapp,
  tamanhoArquivoBytes,
  DURACAO_MINIMA_SEGUNDOS,
  DURACAO_MAXIMA_SEGUNDOS,
  LARGURA,
  ALTURA,
  FPS_SAIDA,
  WHATSAPP_LIMITE_SEGURO_BYTES,
  WHATSAPP_ALVO_BYTES,
};
