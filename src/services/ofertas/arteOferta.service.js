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

function nomeArquivoSeguro(valor) {
  return String(valor || 'produto')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 55)
    .toLowerCase() || 'produto';
}

async function baixarImagem(url) {
  if (!url) throw new Error('Produto sem foto cadastrada.');
  const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`Foto respondeu ${response.status}.`);
  return Buffer.from(await response.arrayBuffer());
}

async function prepararFotoProduto(item, indice) {
  const original = await baixarImagem(item.foto_url);
  const buffer = await sharp(original)
    .rotate()
    .resize(1024, 1024, {
      fit: 'contain',
      background: { r: 255, g: 255, b: 255, alpha: 1 },
      withoutEnlargement: true,
    })
    .jpeg({ quality: 94, mozjpeg: true })
    .toBuffer();

  return {
    buffer,
    nome: `${String(indice + 1).padStart(2, '0')}-${nomeArquivoSeguro(item.nome)}.jpg`,
    tipo: 'image/jpeg',
  };
}

async function prepararReferencias(itens) {
  const referencias = [];
  const falhas = [];

  for (let indice = 0; indice < itens.length; indice += 1) {
    const item = itens[indice];
    try {
      referencias.push(await prepararFotoProduto(item, indice));
    } catch (error) {
      falhas.push(`${item.nome}: ${error.message}`);
    }
  }

  if (falhas.length) {
    throw new Error(`Não foi possível preparar todas as fotos reais dos produtos. ${falhas.join(' | ')}`);
  }

  return referencias;
}

function montarPrompt(oferta) {
  const produtos = oferta.itens.map((item, indice) => {
    const numero = indice + 1;
    return [
      `PRODUTO ${numero}`,
      `- A imagem de entrada nº ${numero} é a fotografia real deste produto.`,
      `- Nome exato para a lista: ${item.nome}`,
      `- Categoria: ${item.categoria || item.categoria_nome || 'utensílio de alumínio'}`,
      `- Quantidade no kit: ${item.quantidade}`,
      '- Regra visual: conservar o mesmo corpo, tampa, alças, pegadores, acabamento, proporções e características reconhecíveis da fotografia.',
    ].join('\n');
  }).join('\n\n');

  const orientacaoExtra = String(oferta.prompt_cenario || '').trim();

  return `PAPEL
Você é um diretor de arte especializado em publicidade comercial brasileira para atacado e varejo de utensílios domésticos.

OBJETIVO
Crie uma única arte publicitária vertical completa para Status do WhatsApp, em português do Brasil, proporção 9:16. A arte deve vender o kit descrito abaixo e utilizar SOMENTE as fotografias reais dos produtos fornecidas como imagens de entrada.

REGRA MAIS IMPORTANTE: FIDELIDADE DOS PRODUTOS
- Cada imagem de entrada representa um produto comercial real e diferente.
- Preserve visualmente cada produto. Não redesenhe, não estilize, não substitua e não invente modelos de panelas.
- Não altere corpo, diâmetro aparente, altura, tampa, alças, pegadores, bordas, acabamento, cor ou proporções.
- Não misture características de um produto com outro.
- Não acrescente peças inexistentes e não elimine produtos.
- Você pode remover apenas o fundo original das fotos, ajustar escala, perspectiva, sombra e iluminação para integrar os produtos ao anúncio.
- Os produtos precisam continuar reconhecíveis como os mesmos produtos das fotografias de entrada.
- Se houver conflito entre beleza e fidelidade, priorize a fidelidade.

IMAGENS DE ENTRADA E IDENTIFICAÇÃO
As imagens foram enviadas na mesma ordem da lista abaixo. A imagem nº 1 corresponde ao PRODUTO 1, a imagem nº 2 ao PRODUTO 2, e assim por diante.

${produtos}

DIREÇÃO VISUAL
- Crie um layout comercial original; não use nenhuma imagem externa como referência.
- Fundo predominantemente preto, com detalhes dourados e textos brancos.
- Aparência premium, limpa, moderna e apropriada para uma loja de utensílios de alumínio.
- Produtos agrupados no centro como fotografia de catálogo, com iluminação comercial e sombras realistas.
- Não use cartões brancos, molduras de catálogo, interface de aplicativo, pessoas, mãos, cozinhas completas ou cenários que escondam os produtos.
- Alto contraste e leitura fácil em tela de celular.

HIERARQUIA OBRIGATÓRIA
1. Título principal.
2. Fotografias reais e reconhecíveis dos produtos.
3. Quantidade total de peças.
4. PREÇO MÉDIO DO KIT como principal destaque financeiro.
5. Lista dos produtos com quantidades.
6. Valor total do kit com destaque menor.
7. Chamada para ação e contatos.

TÍTULO PRINCIPAL
${oferta.titulo}

TEXTOS E NÚMEROS OBRIGATÓRIOS
- ${oferta.total_itens} PEÇAS
- PREÇO MÉDIO DO KIT: R$ ${moeda(oferta.preco_medio)}
- VALOR TOTAL DO KIT: R$ ${moeda(oferta.total)}

LISTA OBRIGATÓRIA DOS PRODUTOS
${oferta.itens.map((item) => `- ${item.quantidade}x ${item.nome}`).join('\n')}

CONTATOS OBRIGATÓRIOS
- Telefone: (83) 9.9979.2085
- Instagram: @aluminiojrpb
- George

CHAMADA OBRIGATÓRIA
CLIQUE NO LINK ABAIXO

REGRAS DE TEXTO
- Copie exatamente nomes, quantidades e valores fornecidos.
- Não crie promoções, descontos, parcelas, porcentagens, marcas ou frases adicionais.
- Revise ortografia, acentos e números antes de finalizar.
- Não repita informações.

REGRAS NEGATIVAS FINAIS
- Não inventar panelas.
- Não transformar os produtos em ilustrações, pinturas ou renderizações genéricas.
- Não trocar tampas ou alças.
- Não fundir dois produtos em um.
- Não mostrar a folha de referência, nomes de arquivos ou instruções deste prompt.
- Não adicionar logotipos ou dados que não foram fornecidos.${orientacaoExtra ? `\n\nPREFERÊNCIA ADICIONAL DO ADMINISTRADOR\n${orientacaoExtra}` : ''}`;
}

async function gerarArte(oferta) {
  if (!Array.isArray(oferta.itens) || oferta.itens.length === 0) {
    throw new Error('A oferta não possui itens.');
  }
  if (oferta.itens.length > MAX_ITENS) {
    throw new Error(`A arte aceita no máximo ${MAX_ITENS} produtos diferentes.`);
  }

  const referencias = await prepararReferencias(oferta.itens);
  const imagemGerada = await openaiImagemService.gerarArteCompleta({
    prompt: montarPrompt(oferta),
    referencias,
  });

  // Apenas normaliza a dimensão final. Não recorta nem cola produtos ou textos.
  return sharp(imagemGerada)
    .resize(WIDTH, HEIGHT, { fit: 'cover', position: 'centre' })
    .jpeg({ quality: 93, mozjpeg: true })
    .toBuffer();
}

module.exports = { gerarArte, MAX_ITENS };
