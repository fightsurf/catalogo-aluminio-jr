const sharp = require('sharp');

const WIDTH = 1080;
const HEIGHT = 1920;
const MAX_ITENS = 12;

const PALETA = {
  fundo: '#080808',
  fundo2: '#17120a',
  dourado: '#D7A928',
  douradoClaro: '#F4D56A',
  branco: '#FFFFFF',
  cinza: '#D8D8D8',
  cinzaEscuro: '#252525',
};

function moeda(valor) {
  return Number(valor || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function escaparXml(valor) {
  return String(valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function quebrarTexto(texto, maxCaracteres, maxLinhas = 2) {
  const palavras = String(texto || '').trim().split(/\s+/).filter(Boolean);
  const linhas = [];
  let linha = '';

  for (const palavra of palavras) {
    const teste = linha ? `${linha} ${palavra}` : palavra;
    if (teste.length <= maxCaracteres || !linha) {
      linha = teste;
      continue;
    }
    linhas.push(linha);
    linha = palavra;
    if (linhas.length >= maxLinhas - 1) break;
  }

  if (linha && linhas.length < maxLinhas) linhas.push(linha);

  const consumido = linhas.join(' ').split(/\s+/).length;
  if (consumido < palavras.length && linhas.length) {
    linhas[linhas.length - 1] = `${linhas[linhas.length - 1].replace(/[.,;:!?-]*$/, '')}…`;
  }

  return linhas;
}

async function baixarImagem(url) {
  if (!url) throw new Error('Produto sem foto cadastrada.');
  const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`Foto respondeu ${response.status}.`);
  return Buffer.from(await response.arrayBuffer());
}

async function prepararFoto(item, largura, altura) {
  const original = await baixarImagem(item.foto_url);

  // Mantém a fotografia real do produto. O trim remove somente bordas uniformes,
  // sem tentar redesenhar, recortar por IA ou alterar o produto.
  let pipeline = sharp(original).rotate();
  try {
    pipeline = pipeline.trim({ background: '#ffffff', threshold: 18 });
  } catch (_) {
    // Algumas imagens não permitem trim; nesse caso usamos a foto original.
  }

  return pipeline
    .resize(largura, altura, {
      fit: 'contain',
      position: 'centre',
      background: { r: 255, g: 255, b: 255, alpha: 0 },
      withoutEnlargement: true,
    })
    .modulate({ brightness: 1.03, saturation: 1.02 })
    .sharpen({ sigma: 0.7 })
    .png()
    .toBuffer();
}

function layoutGrade(total) {
  if (total <= 1) return { colunas: 1, linhas: 1 };
  if (total <= 4) return { colunas: 2, linhas: 2 };
  if (total <= 6) return { colunas: 2, linhas: 3 };
  if (total <= 9) return { colunas: 3, linhas: 3 };
  return { colunas: 3, linhas: 4 };
}

function fundoSvg() {
  return Buffer.from(`
  <svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${PALETA.fundo}"/>
        <stop offset="0.55" stop-color="#111111"/>
        <stop offset="1" stop-color="${PALETA.fundo2}"/>
      </linearGradient>
      <radialGradient id="glow" cx="50%" cy="42%" r="55%">
        <stop offset="0" stop-color="#A97712" stop-opacity="0.24"/>
        <stop offset="1" stop-color="#A97712" stop-opacity="0"/>
      </radialGradient>
      <linearGradient id="gold" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#8D6510"/>
        <stop offset="0.5" stop-color="${PALETA.douradoClaro}"/>
        <stop offset="1" stop-color="#A87815"/>
      </linearGradient>
      <filter id="blur"><feGaussianBlur stdDeviation="34"/></filter>
    </defs>
    <rect width="1080" height="1920" fill="url(#bg)"/>
    <ellipse cx="540" cy="820" rx="500" ry="620" fill="url(#glow)"/>
    <circle cx="90" cy="260" r="145" fill="#B88B23" opacity="0.07" filter="url(#blur)"/>
    <circle cx="960" cy="1450" r="190" fill="#B88B23" opacity="0.06" filter="url(#blur)"/>
    <rect x="0" y="0" width="1080" height="16" fill="url(#gold)"/>
    <rect x="54" y="42" width="972" height="2" fill="#E6C052" opacity="0.45"/>
    <rect x="54" y="1778" width="972" height="2" fill="#E6C052" opacity="0.45"/>
  </svg>`);
}

function cabecalhoSvg(oferta) {
  const titulo = quebrarTexto(oferta.titulo || 'Kit Feirinha Especial', 25, 2);
  const tituloSvg = titulo.map((linha, i) =>
    `<text x="540" y="${132 + (i * 68)}" text-anchor="middle" font-family="Arial, sans-serif" font-size="62" font-weight="900" fill="${PALETA.branco}">${escaparXml(linha.toUpperCase())}</text>`
  ).join('');

  const ySub = titulo.length > 1 ? 290 : 222;

  return Buffer.from(`
  <svg width="1080" height="360" xmlns="http://www.w3.org/2000/svg">
    <text x="540" y="78" text-anchor="middle" font-family="Arial, sans-serif" font-size="25" font-weight="700" letter-spacing="7" fill="${PALETA.douradoClaro}">ALUMÍNIO JR</text>
    ${tituloSvg}
    <rect x="356" y="${ySub}" width="368" height="54" rx="27" fill="${PALETA.dourado}"/>
    <text x="540" y="${ySub + 37}" text-anchor="middle" font-family="Arial, sans-serif" font-size="29" font-weight="900" fill="#0A0A0A">${Number(oferta.total_itens || 0)} PEÇAS NO KIT</text>
  </svg>`);
}

function cardSvg(item, largura, altura) {
  const nome = quebrarTexto(item.nome, largura >= 430 ? 25 : 18, 2);
  const linhas = nome.map((linha, i) =>
    `<text x="${largura / 2}" y="${altura - 61 + (i * 26)}" text-anchor="middle" font-family="Arial, sans-serif" font-size="${largura >= 430 ? 24 : 20}" font-weight="700" fill="#FFFFFF">${escaparXml(linha)}</text>`
  ).join('');

  return Buffer.from(`
  <svg width="${largura}" height="${altura}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="card" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#242424"/>
        <stop offset="1" stop-color="#101010"/>
      </linearGradient>
      <filter id="shadow" x="-30%" y="-30%" width="160%" height="160%">
        <feDropShadow dx="0" dy="14" stdDeviation="13" flood-color="#000000" flood-opacity="0.66"/>
      </filter>
      <linearGradient id="rim" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#F1D26A"/>
        <stop offset="0.5" stop-color="#5E4511"/>
        <stop offset="1" stop-color="#D6A92E"/>
      </linearGradient>
    </defs>
    <rect x="10" y="10" width="${largura - 20}" height="${altura - 20}" rx="28" fill="url(#card)" stroke="url(#rim)" stroke-width="2" filter="url(#shadow)"/>
    <rect x="${largura - 88}" y="24" width="64" height="46" rx="23" fill="#D7A928"/>
    <text x="${largura - 56}" y="56" text-anchor="middle" font-family="Arial, sans-serif" font-size="22" font-weight="900" fill="#0A0A0A">${Number(item.quantidade || 0)}x</text>
    <rect x="27" y="${altura - 102}" width="${largura - 54}" height="78" rx="18" fill="#050505" fill-opacity="0.80"/>
    ${linhas}
  </svg>`);
}

function precoSvg(oferta) {
  return Buffer.from(`
  <svg width="1080" height="420" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="goldPrice" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#F5D86A"/>
        <stop offset="0.45" stop-color="#C99419"/>
        <stop offset="1" stop-color="#8A6110"/>
      </linearGradient>
      <filter id="shadow"><feDropShadow dx="0" dy="12" stdDeviation="10" flood-color="#000" flood-opacity="0.65"/></filter>
    </defs>
    <rect x="70" y="20" width="940" height="250" rx="36" fill="#0E0E0E" stroke="#D7A928" stroke-width="3" filter="url(#shadow)"/>
    <text x="540" y="77" text-anchor="middle" font-family="Arial, sans-serif" font-size="28" font-weight="800" letter-spacing="2" fill="#FFFFFF">PREÇO MÉDIO DO KIT</text>
    <text x="540" y="184" text-anchor="middle" font-family="Arial, sans-serif" font-size="82" font-weight="900" fill="url(#goldPrice)">R$ ${moeda(oferta.preco_medio)}</text>
    <text x="540" y="237" text-anchor="middle" font-family="Arial, sans-serif" font-size="25" font-weight="700" fill="#D8D8D8">Valor total: R$ ${moeda(oferta.total)}</text>

    <rect x="126" y="302" width="828" height="70" rx="35" fill="#D7A928"/>
    <text x="540" y="348" text-anchor="middle" font-family="Arial, sans-serif" font-size="31" font-weight="900" fill="#080808">CLIQUE NO LINK ABAIXO</text>
  </svg>`);
}

function rodapeSvg() {
  return Buffer.from(`
  <svg width="1080" height="130" xmlns="http://www.w3.org/2000/svg">
    <text x="540" y="42" text-anchor="middle" font-family="Arial, sans-serif" font-size="27" font-weight="800" fill="#FFFFFF">(83) 9.9979.2085  •  @aluminiojrpb</text>
    <text x="540" y="84" text-anchor="middle" font-family="Arial, sans-serif" font-size="25" font-weight="700" fill="#E9C95E">George</text>
  </svg>`);
}

async function gerarArte(oferta) {
  if (!Array.isArray(oferta.itens) || oferta.itens.length === 0) {
    throw new Error('A oferta não possui itens.');
  }
  if (oferta.itens.length > MAX_ITENS) {
    throw new Error(`A arte aceita no máximo ${MAX_ITENS} produtos diferentes.`);
  }

  const total = oferta.itens.length;
  const { colunas, linhas } = layoutGrade(total);
  const margemX = 52;
  const gap = colunas === 3 ? 18 : 24;
  const areaTopo = 340;
  const areaProdutosAltura = linhas === 4 ? 1020 : 980;
  const cardLargura = Math.floor((WIDTH - (margemX * 2) - (gap * (colunas - 1))) / colunas);
  const cardAltura = Math.floor((areaProdutosAltura - (gap * (linhas - 1))) / linhas);
  const fotoLargura = cardLargura - 46;
  const fotoAltura = cardAltura - 120;

  const composites = [
    { input: fundoSvg(), left: 0, top: 0 },
    { input: cabecalhoSvg(oferta), left: 0, top: 36 },
  ];

  const falhas = [];
  for (let indice = 0; indice < total; indice += 1) {
    const item = oferta.itens[indice];
    const coluna = indice % colunas;
    const linha = Math.floor(indice / colunas);
    const left = margemX + coluna * (cardLargura + gap);
    const top = areaTopo + linha * (cardAltura + gap);

    try {
      const foto = await prepararFoto(item, fotoLargura, fotoAltura);
      composites.push({ input: cardSvg(item, cardLargura, cardAltura), left, top });
      composites.push({
        input: foto,
        left: left + Math.floor((cardLargura - fotoLargura) / 2),
        top: top + 24,
      });
    } catch (error) {
      falhas.push(`${item.nome}: ${error.message}`);
    }
  }

  if (falhas.length) {
    throw new Error(`Não foi possível preparar todas as fotos reais dos produtos. ${falhas.join(' | ')}`);
  }

  const produtosFim = areaTopo + areaProdutosAltura;
  composites.push({ input: precoSvg(oferta), left: 0, top: Math.min(produtosFim + 22, 1375) });
  composites.push({ input: rodapeSvg(), left: 0, top: 1785 });

  return sharp({
    create: {
      width: WIDTH,
      height: HEIGHT,
      channels: 4,
      background: { r: 8, g: 8, b: 8, alpha: 1 },
    },
  })
    .composite(composites)
    .flatten({ background: PALETA.fundo })
    .jpeg({ quality: 94, mozjpeg: true, chromaSubsampling: '4:4:4' })
    .toBuffer();
}

module.exports = { gerarArte, MAX_ITENS };
