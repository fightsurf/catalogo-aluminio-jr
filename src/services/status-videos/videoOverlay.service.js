const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const sharp = require('sharp');

const LARGURA = 1080;
const ALTURA = 1920;
const DURACAO_MINIMA_SEGUNDOS = 3;
const DURACAO_MAXIMA_SEGUNDOS = 60;

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

function estimarLargura(texto, tamanhoFonte, paddingX = 24) {
  const caracteres = Array.from(String(texto || '')).length;
  return Math.min(LARGURA - 96, Math.max(180, Math.ceil(caracteres * tamanhoFonte * 0.56 + paddingX * 2)));
}

function linhaSvg({ texto, x, y, tamanhoFonte = 48, centralizarEm = null, peso = 500 }) {
  const altura = Math.ceil(tamanhoFonte * 1.48);
  const largura = estimarLargura(texto, tamanhoFonte);
  const posX = centralizarEm === null ? x : Math.round(centralizarEm - largura / 2);
  const baseline = Math.round(y + altura * 0.68);

  return {
    largura,
    altura,
    x: posX,
    svg: `
      <rect x="${posX}" y="${y}" width="${largura}" height="${altura}" rx="18" ry="18"
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

  const margemX = 54;
  const topo1 = linhaSvg({ texto: zap, x: margemX, y: 82, tamanhoFonte: 48 });
  const topo2 = linhaSvg({ texto: instagram, x: margemX, y: 160, tamanhoFonte: 48 });
  const larguraTopo = Math.max(topo1.largura, topo2.largura);
  const centroTopo = margemX + larguraTopo / 2;
  const topo3 = linhaSvg({ texto: nome, x: margemX, y: 238, tamanhoFonte: 48, centralizarEm: centroTopo, peso: 600 });

  const centroVideo = LARGURA / 2;
  const baixo1 = linhaSvg({ texto: cadaItem, x: 0, y: 1320, tamanhoFonte: 52, centralizarEm: centroVideo });
  const baixo2 = linhaSvg({ texto: kit, x: 0, y: 1404, tamanhoFonte: 52, centralizarEm: centroVideo });
  const baixo3 = linhaSvg({ texto: itens, x: 0, y: 1488, tamanhoFonte: 52, centralizarEm: centroVideo, peso: 600 });

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
  await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(arquivo);
  return arquivo;
}

function executarFfmpeg(args, { aceitarFalha = false } = {}) {
  return new Promise((resolve, reject) => {
    const processo = spawn(ffmpegPath(), args, { windowsHide: true });
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
  const { stderr } = await executarFfmpeg(['-hide_banner', '-i', caminhoVideo], { aceitarFalha: true });
  const match = stderr.match(/Duration:\s*(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/i);
  if (!match) throw new Error('Não foi possível identificar a duração do vídeo.');
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

async function gerarVideoFinal({ caminhoEntrada, precoMedio, valorTotal, quantidadeItens }) {
  if (!caminhoEntrada) throw new Error('Vídeo de entrada não informado.');

  const duracao = await obterDuracaoSegundos(caminhoEntrada);
  if (duracao < DURACAO_MINIMA_SEGUNDOS) {
    throw new Error(`O vídeo precisa ter pelo menos ${DURACAO_MINIMA_SEGUNDOS} segundos para publicação nos Stories.`);
  }
  if (duracao > DURACAO_MAXIMA_SEGUNDOS + 0.2) {
    throw new Error(`O vídeo tem ${duracao.toFixed(1)}s. Para publicar nos Stories do Instagram e Facebook, use no máximo ${DURACAO_MAXIMA_SEGUNDOS}s.`);
  }

  const overlay = await criarOverlayPng({ precoMedio, valorTotal, quantidadeItens });
  const saida = path.join(os.tmpdir(), `status-video-final-${Date.now()}-${crypto.randomBytes(6).toString('hex')}.mp4`);

  try {
    await executarFfmpeg([
      '-y',
      '-i', caminhoEntrada,
      '-loop', '1', '-i', overlay,
      '-filter_complex',
      `[0:v]scale=${LARGURA}:${ALTURA}:force_original_aspect_ratio=decrease,pad=${LARGURA}:${ALTURA}:(ow-iw)/2:(oh-ih)/2:black,setsar=1[base];[base][1:v]overlay=0:0:shortest=1[outv]`,
      '-map', '[outv]',
      '-map', '0:a?',
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '22',
      '-pix_fmt', 'yuv420p',
      '-profile:v', 'high',
      '-level', '4.1',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-ar', '44100',
      '-movflags', '+faststart',
      '-shortest',
      saida,
    ]);
  } finally {
    await fs.unlink(overlay).catch(() => {});
  }

  return {
    caminho: saida,
    duracao_segundos: Number(duracao.toFixed(2)),
    largura: LARGURA,
    altura: ALTURA,
  };
}

module.exports = {
  gerarVideoFinal,
  DURACAO_MINIMA_SEGUNDOS,
  DURACAO_MAXIMA_SEGUNDOS,
  LARGURA,
  ALTURA,
};
