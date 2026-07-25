const sharp = require('sharp');

const WIDTH = 1080;
const HEIGHT = 1920;
const MAX_ITENS = 12;

const TEMAS = {
  claro: {
    nome: 'Claro premium',
    fundoInicio: '#FFFDF7',
    fundoFim: '#E9D8B7',
    destaque: '#A46B16',
    texto: '#24211D',
  },
  branco: {
    nome: 'Branco comercial',
    fundoInicio: '#FFFFFF',
    fundoFim: '#E9EDF2',
    destaque: '#B27A22',
    texto: '#19212B',
  },
  escuro: {
    nome: 'Escuro premium',
    fundoInicio: '#080808',
    fundoFim: '#17120A',
    destaque: '#D7A928',
    texto: '#FFFFFF',
  },
  azul: {
    nome: 'Azul elegante',
    fundoInicio: '#F1F8FC',
    fundoFim: '#BFD8E8',
    destaque: '#17638A',
    texto: '#142936',
  },
  verde: {
    nome: 'Verde sofisticado',
    fundoInicio: '#F4F8F1',
    fundoFim: '#C9D9BD',
    destaque: '#3F6F49',
    texto: '#213428',
  },
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

function corHex(valor, fallback) {
  const texto = String(valor || '').trim();
  return /^#[0-9a-fA-F]{6}$/.test(texto) ? texto.toUpperCase() : fallback;
}

function hexRgb(hex) {
  const valor = corHex(hex, '#000000').slice(1);
  return {
    r: Number.parseInt(valor.slice(0, 2), 16),
    g: Number.parseInt(valor.slice(2, 4), 16),
    b: Number.parseInt(valor.slice(4, 6), 16),
  };
}

function rgbHex({ r, g, b }) {
  const canal = numero => Math.max(0, Math.min(255, Math.round(numero))).toString(16).padStart(2, '0');
  return `#${canal(r)}${canal(g)}${canal(b)}`.toUpperCase();
}

function misturar(corA, corB, proporcao) {
  const a = hexRgb(corA);
  const b = hexRgb(corB);
  const p = Math.max(0, Math.min(1, proporcao));
  return rgbHex({
    r: a.r + ((b.r - a.r) * p),
    g: a.g + ((b.g - a.g) * p),
    b: a.b + ((b.b - a.b) * p),
  });
}

function luminancia(hex) {
  const { r, g, b } = hexRgb(hex);
  const canais = [r, g, b].map(valor => {
    const c = valor / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return (0.2126 * canais[0]) + (0.7152 * canais[1]) + (0.0722 * canais[2]);
}

function resolverPaleta(oferta) {
  const temaId = Object.hasOwn(TEMAS, oferta.tema_arte) ? oferta.tema_arte : 'claro';
  const base = TEMAS[temaId];
  const personalizadas = oferta.cores_arte && typeof oferta.cores_arte === 'object' ? oferta.cores_arte : {};

  const fundoInicio = corHex(personalizadas.fundoInicio, base.fundoInicio);
  const fundoFim = corHex(personalizadas.fundoFim, base.fundoFim);
  const destaque = corHex(personalizadas.destaque, base.destaque);
  const texto = corHex(personalizadas.texto, base.texto);
  const fundoMedio = misturar(fundoInicio, fundoFim, 0.5);
  const claro = luminancia(fundoMedio) > 0.48;

  return {
    temaId,
    fundoInicio,
    fundoFim,
    fundoMedio,
    destaque,
    destaqueClaro: misturar(destaque, '#FFFFFF', claro ? 0.18 : 0.35),
    destaqueEscuro: misturar(destaque, '#000000', claro ? 0.25 : 0.10),
    texto,
    textoSecundario: misturar(texto, fundoMedio, claro ? 0.32 : 0.24),
    cartao: claro ? '#FFFFFF' : misturar(fundoMedio, '#000000', 0.34),
    cartaoTexto: claro ? texto : '#FFFFFF',
    faixaNome: claro ? '#FFFFFF' : '#050505',
    faixaNomeOpacidade: claro ? 0.88 : 0.80,
    sombra: claro ? '#4E4437' : '#000000',
    sombraOpacidade: claro ? 0.22 : 0.66,
    borda: misturar(destaque, claro ? '#FFFFFF' : '#000000', claro ? 0.18 : 0.20),
    botaoTexto: luminancia(destaque) > 0.52 ? '#15120C' : '#FFFFFF',
    fundoPreco: claro ? '#FFFFFF' : misturar(fundoMedio, '#000000', 0.48),
    claro,
  };
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
  let pipeline = sharp(original).rotate();
  try {
    pipeline = pipeline.trim({ background: '#ffffff', threshold: 18 });
  } catch (_) {
    // Se o trim não for compatível, preserva a fotografia original.
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

function fundoSvg(p) {
  const glow = p.claro ? misturar(p.destaque, '#FFFFFF', 0.45) : p.destaque;
  return Buffer.from(`
  <svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${p.fundoInicio}"/>
        <stop offset="0.55" stop-color="${p.fundoMedio}"/>
        <stop offset="1" stop-color="${p.fundoFim}"/>
      </linearGradient>
      <radialGradient id="glow" cx="50%" cy="42%" r="57%">
        <stop offset="0" stop-color="${glow}" stop-opacity="${p.claro ? '0.30' : '0.24'}"/>
        <stop offset="1" stop-color="${glow}" stop-opacity="0"/>
      </radialGradient>
      <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="${p.destaqueEscuro}"/>
        <stop offset="0.5" stop-color="${p.destaqueClaro}"/>
        <stop offset="1" stop-color="${p.destaque}"/>
      </linearGradient>
      <filter id="blur"><feGaussianBlur stdDeviation="34"/></filter>
    </defs>
    <rect width="1080" height="1920" fill="url(#bg)"/>
    <ellipse cx="540" cy="820" rx="500" ry="620" fill="url(#glow)"/>
    <circle cx="90" cy="260" r="145" fill="${p.destaque}" opacity="${p.claro ? '0.12' : '0.07'}" filter="url(#blur)"/>
    <circle cx="960" cy="1450" r="190" fill="${p.destaque}" opacity="${p.claro ? '0.10' : '0.06'}" filter="url(#blur)"/>
    <rect x="0" y="0" width="1080" height="16" fill="url(#accent)"/>
    <rect x="54" y="42" width="972" height="2" fill="${p.destaque}" opacity="0.48"/>
    <rect x="54" y="1778" width="972" height="2" fill="${p.destaque}" opacity="0.48"/>
  </svg>`);
}

function cabecalhoSvg(oferta, p) {
  const titulo = quebrarTexto(oferta.titulo || 'Kit Feirinha Especial', 25, 2);
  const tituloSvg = titulo.map((linha, i) =>
    `<text x="540" y="${132 + (i * 68)}" text-anchor="middle" font-family="Arial, sans-serif" font-size="62" font-weight="900" fill="${p.texto}">${escaparXml(linha.toUpperCase())}</text>`
  ).join('');
  const ySub = titulo.length > 1 ? 290 : 222;

  return Buffer.from(`
  <svg width="1080" height="360" xmlns="http://www.w3.org/2000/svg">
    <text x="540" y="78" text-anchor="middle" font-family="Arial, sans-serif" font-size="25" font-weight="700" letter-spacing="7" fill="${p.destaque}">ALUMÍNIO JR</text>
    ${tituloSvg}
    <rect x="356" y="${ySub}" width="368" height="54" rx="27" fill="${p.destaque}"/>
    <text x="540" y="${ySub + 37}" text-anchor="middle" font-family="Arial, sans-serif" font-size="29" font-weight="900" fill="${p.botaoTexto}">${Number(oferta.total_itens || 0)} PEÇAS NO KIT</text>
  </svg>`);
}

function cardSvg(item, largura, altura, p) {
  const nome = quebrarTexto(item.nome, largura >= 430 ? 25 : 18, 2);
  const linhas = nome.map((linha, i) =>
    `<text x="${largura / 2}" y="${altura - 61 + (i * 26)}" text-anchor="middle" font-family="Arial, sans-serif" font-size="${largura >= 430 ? 24 : 20}" font-weight="700" fill="${p.cartaoTexto}">${escaparXml(linha)}</text>`
  ).join('');

  return Buffer.from(`
  <svg width="${largura}" height="${altura}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="card" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${misturar(p.cartao, '#FFFFFF', p.claro ? 0.06 : 0.10)}"/>
        <stop offset="1" stop-color="${p.cartao}"/>
      </linearGradient>
      <filter id="shadow" x="-30%" y="-30%" width="160%" height="160%">
        <feDropShadow dx="0" dy="14" stdDeviation="13" flood-color="${p.sombra}" flood-opacity="${p.sombraOpacidade}"/>
      </filter>
      <linearGradient id="rim" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${p.destaqueClaro}"/>
        <stop offset="0.5" stop-color="${p.destaqueEscuro}"/>
        <stop offset="1" stop-color="${p.destaque}"/>
      </linearGradient>
    </defs>
    <rect x="10" y="10" width="${largura - 20}" height="${altura - 20}" rx="28" fill="url(#card)" stroke="url(#rim)" stroke-width="2" filter="url(#shadow)"/>
    <rect x="${largura - 88}" y="24" width="64" height="46" rx="23" fill="${p.destaque}"/>
    <text x="${largura - 56}" y="56" text-anchor="middle" font-family="Arial, sans-serif" font-size="22" font-weight="900" fill="${p.botaoTexto}">${Number(item.quantidade || 0)}x</text>
    <rect x="27" y="${altura - 102}" width="${largura - 54}" height="78" rx="18" fill="${p.faixaNome}" fill-opacity="${p.faixaNomeOpacidade}"/>
    ${linhas}
  </svg>`);
}

function precoSvg(oferta, p) {
  return Buffer.from(`
  <svg width="1080" height="420" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="price" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${p.destaqueClaro}"/>
        <stop offset="0.45" stop-color="${p.destaque}"/>
        <stop offset="1" stop-color="${p.destaqueEscuro}"/>
      </linearGradient>
      <filter id="shadow"><feDropShadow dx="0" dy="12" stdDeviation="10" flood-color="${p.sombra}" flood-opacity="${p.sombraOpacidade}"/></filter>
    </defs>
    <rect x="70" y="20" width="940" height="250" rx="36" fill="${p.fundoPreco}" stroke="${p.destaque}" stroke-width="3" filter="url(#shadow)"/>
    <text x="540" y="77" text-anchor="middle" font-family="Arial, sans-serif" font-size="28" font-weight="800" letter-spacing="2" fill="${p.texto}">PREÇO MÉDIO DO KIT</text>
    <text x="540" y="184" text-anchor="middle" font-family="Arial, sans-serif" font-size="82" font-weight="900" fill="url(#price)">R$ ${moeda(oferta.preco_medio)}</text>
    <text x="540" y="237" text-anchor="middle" font-family="Arial, sans-serif" font-size="25" font-weight="700" fill="${p.textoSecundario}">Valor total: R$ ${moeda(oferta.total)}</text>
    <rect x="126" y="302" width="828" height="70" rx="35" fill="${p.destaque}"/>
    <text x="540" y="348" text-anchor="middle" font-family="Arial, sans-serif" font-size="31" font-weight="900" fill="${p.botaoTexto}">CLIQUE NO LINK ABAIXO</text>
  </svg>`);
}

function rodapeSvg(p) {
  return Buffer.from(`
  <svg width="1080" height="130" xmlns="http://www.w3.org/2000/svg">
    <text x="540" y="42" text-anchor="middle" font-family="Arial, sans-serif" font-size="27" font-weight="800" fill="${p.texto}">(83) 9.9979.2085  •  @aluminiojrpb</text>
    <text x="540" y="84" text-anchor="middle" font-family="Arial, sans-serif" font-size="25" font-weight="700" fill="${p.destaque}">George</text>
  </svg>`);
}

async function gerarArte(oferta) {
  if (!Array.isArray(oferta.itens) || oferta.itens.length === 0) {
    throw new Error('A oferta não possui itens.');
  }
  if (oferta.itens.length > MAX_ITENS) {
    throw new Error(`A arte aceita no máximo ${MAX_ITENS} produtos diferentes.`);
  }

  const paleta = resolverPaleta(oferta);
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
    { input: fundoSvg(paleta), left: 0, top: 0 },
    { input: cabecalhoSvg(oferta, paleta), left: 0, top: 36 },
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
      composites.push({ input: cardSvg(item, cardLargura, cardAltura, paleta), left, top });
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
  composites.push({ input: precoSvg(oferta, paleta), left: 0, top: Math.min(produtosFim + 22, 1375) });
  composites.push({ input: rodapeSvg(paleta), left: 0, top: 1785 });

  return sharp({
    create: {
      width: WIDTH,
      height: HEIGHT,
      channels: 4,
      background: { ...hexRgb(paleta.fundoInicio), alpha: 1 },
    },
  })
    .composite(composites)
    .flatten({ background: paleta.fundoInicio })
    .jpeg({ quality: 94, mozjpeg: true, chromaSubsampling: '4:4:4' })
    .toBuffer();
}

module.exports = { gerarArte, MAX_ITENS, TEMAS };
