const sharp = require('sharp');
const openaiImagemService = require('./openaiImagem.service');

const WIDTH = 1080;
const HEIGHT = 1920;
const MAX_ITENS = 12;

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

function quebrar(texto, limite = 24) {
  const palavras = String(texto || '').trim().split(/\s+/);
  const linhas = [];
  let linha = '';
  for (const palavra of palavras) {
    const teste = linha ? `${linha} ${palavra}` : palavra;
    if (teste.length > limite && linha) {
      linhas.push(linha);
      linha = palavra;
    } else linha = teste;
  }
  if (linha) linhas.push(linha);
  return linhas.slice(0, 2);
}

async function baixarImagem(url) {
  if (!url) return null;
  const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`Foto respondeu ${response.status}.`);
  return Buffer.from(await response.arrayBuffer());
}

async function montarReferenciaProdutos(itens) {
  const largura = 1200;
  const colunas = itens.length <= 6 ? 2 : 3;
  const margem = 34;
  const gap = 20;
  const larguraCard = Math.floor((largura - margem * 2 - gap * (colunas - 1)) / colunas);
  const alturaCard = 310;
  const linhas = Math.ceil(itens.length / colunas);
  const altura = margem * 2 + linhas * alturaCard + (linhas - 1) * gap;

  const base = Buffer.from(`<svg width="${largura}" height="${altura}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="#f5f5f4"/>
    <text x="${margem}" y="25" font-family="Arial" font-size="20" font-weight="700" fill="#111827">REFERÊNCIA DOS PRODUTOS — reproduzir estes modelos, sem copiar este layout</text>
  </svg>`);

  const composicoes = [];
  for (let i = 0; i < itens.length; i += 1) {
    const item = itens[i];
    const linha = Math.floor(i / colunas);
    const coluna = i % colunas;
    const left = margem + coluna * (larguraCard + gap);
    const top = margem + linha * (alturaCard + gap);
    const linhasNome = quebrar(item.nome, 25);
    const textos = linhasNome.map((nome, indice) => `<text x="18" y="${230 + indice * 29}" font-family="Arial" font-size="23" font-weight="800" fill="#111827">${escaparXml(nome)}</text>`).join('');
    const card = Buffer.from(`<svg width="${larguraCard}" height="${alturaCard}" xmlns="http://www.w3.org/2000/svg">
      <rect x="1" y="1" width="${larguraCard - 2}" height="${alturaCard - 2}" rx="18" fill="#ffffff" stroke="#d6d3d1" stroke-width="2"/>
      ${textos}
      <text x="18" y="294" font-family="Arial" font-size="20" font-weight="700" fill="#9a3412">Qtd.: ${item.quantidade}</text>
    </svg>`);
    composicoes.push({ input: card, left, top });

    try {
      const foto = await baixarImagem(item.foto_url);
      if (foto) {
        const preparada = await sharp(foto)
          .rotate()
          .resize(larguraCard - 32, 200, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
          .png()
          .toBuffer();
        composicoes.push({ input: preparada, left: left + 16, top: top + 12 });
      }
    } catch (error) {
      console.warn('[Ofertas] Foto não incluída na referência:', item.nome, error.message);
    }
  }

  return sharp(base).composite(composicoes).png().toBuffer();
}

function montarPrompt(oferta) {
  const lista = oferta.itens.map((item, indice) =>
    `${indice + 1}. ${item.nome} — quantidade no kit: ${item.quantidade}`
  ).join('\n');

  const orientacaoExtra = String(oferta.prompt_cenario || '').trim();

  return `Crie uma única arte publicitária vertical completa para Status do WhatsApp, em português do Brasil, proporção 9:16.

Use a primeira imagem apenas como REFERÊNCIA VISUAL de composição: fundo preto elegante, tipografia grande branca e dourada, foto principal dos produtos no centro, lista organizada na parte inferior e caixa de preço em destaque. Não copie nomes, números, marca, pessoa, foto de perfil, interface ou controles do WhatsApp presentes na referência.

Use a segunda imagem como REFERÊNCIA DOS PRODUTOS. Recrie visualmente os modelos de panelas mostrados nela em uma fotografia comercial coerente. Não faça colagem, não use cartões brancos e não mostre o painel de referência. Gere a cena e os produtos como uma única imagem publicitária integrada.

TÍTULO PRINCIPAL:
${oferta.titulo}

ITENS QUE DEVEM APARECER NA LISTA, com suas quantidades:
${lista}

INFORMAÇÕES NUMÉRICAS OBRIGATÓRIAS:
- ${oferta.total_itens} PEÇAS
- PREÇO MÉDIO DO KIT: R$ ${moeda(oferta.preco_medio)}
- VALOR TOTAL DO KIT: R$ ${moeda(oferta.total)}

DADOS OBRIGATÓRIOS:
Telefone: (83) 9.9979.2085
Instagram: @aluminiojrpb
George

CHAMADA OBRIGATÓRIA, grande e legível perto do rodapé:
CLIQUE NO LINK ABAIXO

Hierarquia: dê o maior destaque ao título, aos produtos, à quantidade total de peças e ao PREÇO MÉDIO DO KIT. O valor total deve aparecer, mas menor. Use estética preta, branca e dourada, alto contraste, aparência profissional, sem pessoas e sem outros textos. Revise cuidadosamente a ortografia e os números antes de finalizar.${orientacaoExtra ? `\n\nPreferência adicional do administrador: ${orientacaoExtra}` : ''}`;
}

async function gerarArte(oferta) {
  if (!Array.isArray(oferta.itens) || oferta.itens.length === 0) throw new Error('A oferta não possui itens.');
  if (oferta.itens.length > MAX_ITENS) throw new Error(`A arte aceita no máximo ${MAX_ITENS} produtos diferentes.`);

  const referenciaProdutos = await montarReferenciaProdutos(oferta.itens);
  const imagemGerada = await openaiImagemService.gerarArteCompleta({
    prompt: montarPrompt(oferta),
    referencias: [{
      buffer: referenciaProdutos,
      nome: 'referencia-produtos.png',
      tipo: 'image/png',
    }],
  });

  // Apenas normaliza a dimensão final. Não há recorte/colagem de produtos ou textos.
  return sharp(imagemGerada)
    .resize(WIDTH, HEIGHT, { fit: 'cover', position: 'centre' })
    .jpeg({ quality: 93, mozjpeg: true })
    .toBuffer();
}

module.exports = { gerarArte, MAX_ITENS };
