const fs = require('fs/promises');
const { createWriteStream } = require('fs');
const path = require('path');
const os = require('os');
const dns = require('dns/promises');
const net = require('net');
const { Readable, Transform } = require('stream');
const { pipeline } = require('stream/promises');
const { spawn } = require('child_process');
const sharp = require('sharp');
const MAX_SEGUNDOS = 55;
const MAX_BYTES = 9_500_000;
const MAX_DOWNLOAD = 250 * 1024 * 1024;

function binario() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  return require('ffmpeg-static');
}
function executar(args, aceitarFalha = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(binario(), args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '', expirou = false;
    const timer = setTimeout(() => { expirou = true; child.kill('SIGKILL'); }, 10 * 60 * 1000);
    child.stderr.on('data', b => { stderr = (stderr + b.toString()).slice(-20000); });
    child.on('error', e => { clearTimeout(timer); reject(e); });
    child.on('close', code => {
      clearTimeout(timer);
      if (expirou) return reject(new Error('Tempo excedido ao processar uma parte do vídeo.'));
      if (code && !aceitarFalha) return reject(new Error(`Falha no processamento do vídeo: ${stderr.split('\n').slice(-8).join('\n')}`));
      resolve(stderr);
    });
  });
}
function enderecoPrivado(ip) {
  if (net.isIP(ip) === 6) return !/^2[0-9a-f]{3}:/i.test(ip); // Somente unicast global IPv6.
  const [a,b] = ip.split('.').map(Number);
  return !net.isIP(ip) || a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}
async function validarUrl(valor) {
  const url = new URL(valor);
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) throw new Error('O vídeo deve usar uma URL pública HTTPS.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const enderecos = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
  if (!enderecos.length || enderecos.some(e => enderecoPrivado(e.address))) throw new Error('Endereço de vídeo não permitido. Use uma URL pública.');
  return url;
}
async function baixar(urlInformada, destino) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 180000);
  try {
    let url = urlInformada;
    for (let n=0; n<5; n++) {
      const response = await fetch(await validarUrl(url), { signal: abort.signal, redirect: 'manual' });
      if ([301,302,303,307,308].includes(response.status)) {
        await response.body?.cancel();
        url = new URL(response.headers.get('location'), url).href; continue;
      }
      if (!response.ok) { await response.body?.cancel(); throw new Error(`Falha ao baixar vídeo (HTTP ${response.status}).`); }
      if (Number(response.headers.get('content-length')) > MAX_DOWNLOAD) { await response.body?.cancel(); throw new Error('Vídeo maior que 250 MB.'); }
      let bytes = 0;
      const limite = new Transform({ transform(chunk, encoding, cb) {
        bytes += chunk.length;
        cb(bytes > MAX_DOWNLOAD ? new Error('Vídeo maior que 250 MB.') : null, chunk);
      }});
      await pipeline(Readable.fromWeb(response.body), limite, createWriteStream(destino));
      if (!bytes) throw new Error('Vídeo vazio.');
      return;
    }
    throw new Error('Redirecionamentos demais ao baixar o vídeo.');
  } finally { clearTimeout(timer); }
}
async function duracao(entrada) {
  const texto = await executar(['-hide_banner','-protocol_whitelist','file,pipe','-i',entrada], true);
  const m = texto.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!m || !/Video:/.test(texto)) throw new Error('Arquivo sem vídeo ou duração identificável.');
  return Number(m[1])*3600+Number(m[2])*60+Number(m[3]);
}
function planejar(total) {
  if (!Number.isFinite(total) || total <= 0) throw new Error('Duração do vídeo inválida.');
  // Partes equilibradas evitam um último fragmento inferior aos 3 s exigidos pela Meta.
  const quantidade = Math.ceil(total / MAX_SEGUNDOS);
  const partes = [];
  for (let i=0; i<quantidade; i++) {
    const inicio = Math.round(i * total / quantidade * 1000) / 1000;
    const fim = Math.round((i+1) * total / quantidade * 1000) / 1000;
    partes.push({ numero:i+1, inicio, duracao: Number((fim-inicio).toFixed(3)), duracao_saida:Math.max(3, Number((fim-inicio).toFixed(3))) });
  }
  return partes;
}
function xml(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c])); }
function svg(produto, parte, total) {
  const nome = String(produto.nome).trim();
  const linhas = nome.match(/.{1,29}(?:\s|$)|.{1,29}/g)?.slice(0,3).map(s=>s.trim()) || [];
  if (linhas.join(' ').length < nome.length && linhas.length) linhas[linhas.length-1] = linhas[linhas.length-1].slice(0,26)+'…';
  const texto = linhas.map((s,i)=>`<text x="360" y="${983+i*31}" font-size="26">${xml(s)}</text>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="1280">
    <rect x="25" y="940" width="670" height="245" rx="20" fill="white" fill-opacity="0.96"/>
    <g font-family="Arial, Helvetica, sans-serif" font-weight="700" text-anchor="middle" fill="#111827">
    ${texto}<text x="360" y="1124" font-size="54">${xml(produto.preco_formatado)}</text>
    <text x="360" y="1161" font-size="20" fill="#6b7280">ALUMÍNIO JR${total>1 ? ` · ${parte.numero}/${total}`:''}</text></g></svg>`;
}
async function preparar(produto) {
  const pasta = await fs.mkdtemp(path.join(os.tmpdir(),'status-produto-'));
  try {
    const entrada = path.join(pasta,'original.video');
    await baixar(produto.video_url, entrada);
    const segundos = await duracao(entrada);
    return { pasta, entrada, duracao:segundos, partes:planejar(segundos) };
  } catch(e) { await fs.rm(pasta,{recursive:true,force:true});throw e; }
}
async function gerar(contexto, produto, parte, total) {
  const overlay = path.join(contexto.pasta,`overlay-${parte.numero}.png`);
  const saida = path.join(contexto.pasta,`parte-${parte.numero}.mp4`);
  await sharp(Buffer.from(svg(produto,parte,total))).png().toFile(overlay);
  try {
    let bitrate = Math.min(3000, Math.floor((8_400_000*8 / parte.duracao_saida - 96000)/1000));
    for(let tentativa=0;tentativa<3;tentativa++) {
      const filtro = `[0:v]trim=duration=${parte.duracao},setpts=PTS-STARTPTS,scale=720:1280:force_original_aspect_ratio=decrease:flags=fast_bilinear,pad=720:1280:(ow-iw)/2:(oh-ih)/2:black,fps=30,setsar=1,tpad=stop_mode=clone:stop_duration=3[base];[base][1:v]overlay=0:0[outv]`;
      await executar(['-y','-threads','1','-protocol_whitelist','file,pipe','-ss',String(parte.inicio),'-i',contexto.entrada,
        '-loop','1','-i',overlay,'-filter_threads','1','-filter_complex_threads','1','-filter_complex',filtro,
        '-map','[outv]','-map','0:a:0?','-af','asetpts=PTS-STARTPTS,apad','-map_metadata','-1',
        '-c:v','libx264','-threads','1','-preset','ultrafast','-tune','zerolatency','-refs','1','-bf','0',
        '-b:v',`${bitrate}k`,'-maxrate',`${bitrate}k`,'-bufsize',`${bitrate*2}k`,'-pix_fmt','yuv420p',
        '-c:a','aac','-b:a','96k','-ar','48000','-ac','2','-movflags','+faststart','-t',String(parte.duracao_saida),saida]);
      const tamanho = (await fs.stat(saida)).size;
      if (tamanho <= MAX_BYTES) {
        const real = await duracao(saida);
        if (real < parte.duracao_saida - 0.12 || real > MAX_SEGUNDOS + 0.1) throw new Error('Duração final fora do limite esperado.');
        return { caminho:saida, tamanho_bytes:tamanho, duracao:real };
      }
      bitrate = Math.max(200, Math.floor(bitrate * 8_400_000/tamanho * 0.9));
    }
    throw new Error('Não foi possível comprimir a parte para menos de 9,5 MB.');
  } finally { await fs.unlink(overlay).catch(()=>{}); }
}
module.exports = { preparar, gerar, planejar, svg, duracao, MAX_SEGUNDOS, MAX_BYTES };
