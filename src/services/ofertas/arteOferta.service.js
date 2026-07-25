const sharp = require('sharp');
const openaiImagemService = require('./openaiImagem.service');

const WIDTH = 1080;
const HEIGHT = 1920;
const MAX_ITENS = 12;

function escaparXml(valor) {
  return String(valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function moeda(valor) {
  return Number(valor || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function quebrarTexto(texto, limite = 25) {
  const palavras = String(texto || '').trim().split(/\s+/);
  const linhas = [];
  let linha = '';
  for (const palavra of palavras) {
    const teste = linha ? `${linha} ${palavra}` : palavra;
    if (teste.length > limite && linha) { linhas.push(linha); linha = palavra; }
    else linha = teste;
  }
  if (linha) linhas.push(linha);
  return linhas.slice(0, 2);
}

async function baixarImagem(url) {
  if (!url) return null;
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Não foi possível baixar a foto do produto (${response.status}).`);
  return Buffer.from(await response.arrayBuffer());
}

function svgBase() {
  return Buffer.from(`<svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="overlay" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#111827" stop-opacity="0.60"/>
        <stop offset="0.25" stop-color="#111827" stop-opacity="0.16"/>
        <stop offset="0.75" stop-color="#111827" stop-opacity="0.20"/>
        <stop offset="1" stop-color="#111827" stop-opacity="0.78"/>
      </linearGradient>
    </defs>
    <rect width="1080" height="1920" fill="url(#overlay)"/>
  </svg>`);
}

function svgCabecalho(oferta) {
  return Buffer.from(`<svg width="1080" height="260" xmlns="http://www.w3.org/2000/svg">
    <rect x="45" y="35" rx="30" width="990" height="190" fill="#ffffff" fill-opacity="0.94"/>
    <text x="540" y="112" text-anchor="middle" font-family="Arial, sans-serif" font-size="58" font-weight="800" fill="#9a3412">${escaparXml(oferta.titulo)}</text>
    <text x="540" y="178" text-anchor="middle" font-family="Arial, sans-serif" font-size="32" font-weight="700" fill="#374151">Kit completo • preço médio por item</text>
  </svg>`);
}

function svgCard(item, largura, altura) {
  const linhas = quebrarTexto(item.nome, 23);
  const textoLinhas = linhas.map((l, i) => `<text x="${Math.round(largura*0.46)}" y="${82+i*42}" font-family="Arial, sans-serif" font-size="30" font-weight="800" fill="#111827">${escaparXml(l)}</text>`).join('');
  return Buffer.from(`<svg width="${largura}" height="${altura}" xmlns="http://www.w3.org/2000/svg">
    <rect x="2" y="2" width="${largura-4}" height="${altura-4}" rx="26" fill="#ffffff" fill-opacity="0.95" stroke="#fed7aa" stroke-width="4"/>
    ${textoLinhas}
    <text x="${Math.round(largura*0.46)}" y="${altura-72}" font-family="Arial, sans-serif" font-size="27" font-weight="700" fill="#4b5563">Qtd. no kit: ${item.quantidade}</text>
    <text x="${Math.round(largura*0.46)}" y="${altura-28}" font-family="Arial, sans-serif" font-size="32" font-weight="900" fill="#c2410c">Médio: R$ ${moeda(item.preco_medio)}</text>
  </svg>`);
}

function svgRodape(oferta) {
  return Buffer.from(`<svg width="1080" height="300" xmlns="http://www.w3.org/2000/svg">
    <rect x="45" y="10" width="990" height="270" rx="32" fill="#111827" fill-opacity="0.94"/>
    <text x="540" y="86" text-anchor="middle" font-family="Arial, sans-serif" font-size="35" font-weight="700" fill="#ffffff">VALOR TOTAL DO KIT</text>
    <text x="540" y="158" text-anchor="middle" font-family="Arial, sans-serif" font-size="66" font-weight="900" fill="#fbbf24">R$ ${moeda(oferta.total)}</text>
    <text x="540" y="208" text-anchor="middle" font-family="Arial, sans-serif" font-size="29" font-weight="700" fill="#ffffff">Telefone: (83) 9.9979.2085</text>
    <text x="540" y="246" text-anchor="middle" font-family="Arial, sans-serif" font-size="27" font-weight="700" fill="#ffffff">Instagram: @aluminiojrpb  •  George</text>
  </svg>`);
}

async function criarFundo(prompt) {
  const gerado = await openaiImagemService.gerarCenarioVertical(prompt);
  if (gerado) return sharp(gerado).resize(WIDTH, HEIGHT, { fit: 'cover' }).jpeg({ quality: 90 }).toBuffer();

  const fallback = Buffer.from(`<svg width="1080" height="1920" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#fff7ed"/><stop offset="1" stop-color="#fed7aa"/></linearGradient></defs>
    <rect width="1080" height="1920" fill="url(#g)"/>
    <circle cx="930" cy="260" r="260" fill="#fb923c" fill-opacity="0.18"/>
    <circle cx="120" cy="1580" r="320" fill="#f59e0b" fill-opacity="0.15"/>
  </svg>`);
  return sharp(fallback).jpeg({ quality: 90 }).toBuffer();
}

async function gerarArte(oferta) {
  if (!Array.isArray(oferta.itens) || oferta.itens.length === 0) throw new Error('A oferta não possui itens.');
  if (oferta.itens.length > MAX_ITENS) throw new Error(`A arte aceita no máximo ${MAX_ITENS} produtos diferentes.`);

  const prompt = oferta.prompt_cenario || 'Crie um cenário vertical de fotografia publicitária para uma loja brasileira de panelas de alumínio: cozinha moderna, bancada elegante, iluminação comercial quente, espaço central limpo, sem panelas, sem produtos, sem pessoas, sem logotipos e sem qualquer texto.';
  const fundo = await criarFundo(prompt);
  const colunas = oferta.itens.length <= 5 ? 1 : 2;
  const margem = 55;
  const gap = 22;
  const topo = 285;
  const rodapeY = 1610;
  const larguraCard = Math.floor((WIDTH - margem*2 - gap*(colunas-1))/colunas);
  const linhas = Math.ceil(oferta.itens.length/colunas);
  const alturaCard = Math.min(235, Math.floor((rodapeY - topo - gap*(linhas-1))/linhas));
  const composicoes = [
    { input: svgBase(), top: 0, left: 0 },
    { input: svgCabecalho(oferta), top: 0, left: 0 },
    { input: svgRodape(oferta), top: rodapeY, left: 0 },
  ];

  for (let i=0; i<oferta.itens.length; i+=1) {
    const item = oferta.itens[i];
    const linha = Math.floor(i/colunas);
    const coluna = i%colunas;
    const left = margem + coluna*(larguraCard+gap);
    const top = topo + linha*(alturaCard+gap);
    composicoes.push({ input: svgCard(item, larguraCard, alturaCard), top, left });

    try {
      const foto = await baixarImagem(item.foto_url);
      if (foto) {
        const fotoPreparada = await sharp(foto)
          .rotate()
          .resize(Math.round(larguraCard*0.40), alturaCard-34, { fit: 'contain', background: { r:255,g:255,b:255,alpha:0 } })
          .png()
          .toBuffer();
        composicoes.push({ input: fotoPreparada, top: top+17, left: left+12 });
      }
    } catch (error) {
      console.warn('[Ofertas] Foto ignorada na composição:', item.nome, error.message);
    }
  }

  return sharp(fundo).composite(composicoes).jpeg({ quality: 92, mozjpeg: true }).toBuffer();
}

module.exports = { gerarArte, MAX_ITENS };
