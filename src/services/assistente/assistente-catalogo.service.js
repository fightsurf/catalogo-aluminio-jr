const produtoService = require('../produto/produto.service');

const STOPWORDS = new Set([
  'a', 'o', 'os', 'as', 'um', 'uma', 'uns', 'umas',
  'de', 'da', 'do', 'das', 'dos', 'em', 'no', 'na', 'nos', 'nas',
  'para', 'pra', 'por', 'com', 'sem', 'que', 'qual', 'quais',
  'voce', 'voces', 'vc', 'tem', 'trabalha', 'trabalham', 'vende', 'vendem',
  'tenho', 'teria', 'me', 'manda', 'mande', 'mostra', 'mostrar',
  'quanto', 'custa', 'valor', 'preco', 'preço', 'orcamento', 'orçamento',
  'produto', 'produtos', 'opcao', 'opcoes', 'opção', 'opções',
]);

const BASES_CATALOGO = [
  {
    id: 'panela_pressao',
    nome: 'panela de pressão',
    aliases: ['panela de pressao', 'panela pressao', 'panela de pressão', 'panela pressão', 'pressao', 'pressão'],
    produtoMatch: ['panela pressao', 'panela de pressao', 'pressao'],
  },
  {
    id: 'cafeteira',
    nome: 'cafeteira',
    aliases: ['cafeteira', 'cafeiteira', 'cafeteiras', 'cafe', 'café'],
    produtoMatch: ['cafeteira', 'cafeiteira'],
  },
  {
    id: 'cuscuzeira',
    nome: 'cuscuzeira',
    aliases: ['cuscuzeira', 'cuscuzeiro', 'cuscuz', 'panela de cuscuz', 'panela cuscuz'],
    produtoMatch: ['cuscuzeira', 'cuscuzeiro', 'cuscuz'],
  },
  {
    id: 'frigideira',
    nome: 'frigideira',
    aliases: ['frigideira', 'frigideiras'],
    produtoMatch: ['frigideira'],
  },
  {
    id: 'leiteira',
    nome: 'leiteira',
    aliases: ['leiteira', 'leiteiras'],
    produtoMatch: ['leiteira'],
  },
  {
    id: 'fervedor',
    nome: 'fervedor',
    aliases: ['fervedor', 'fervedores'],
    produtoMatch: ['fervedor'],
  },
  {
    id: 'caldeirao',
    nome: 'caldeirão',
    aliases: ['caldeirao', 'caldeirão', 'caldeiroes', 'caldeirões'],
    produtoMatch: ['caldeirao', 'caldeirão'],
  },
  {
    id: 'assadeira',
    nome: 'assadeira',
    aliases: ['assadeira', 'assadeiras', 'forma', 'formas'],
    produtoMatch: ['assadeira', 'forma'],
  },
  {
    id: 'tampa',
    nome: 'tampa',
    aliases: ['tampa', 'tampas'],
    produtoMatch: ['tampa'],
  },
  {
    id: 'valvula',
    nome: 'válvula',
    aliases: ['valvula', 'válvula', 'valvulas', 'válvulas'],
    produtoMatch: ['valvula'],
  },
  {
    id: 'cabo',
    nome: 'cabo',
    aliases: ['cabo', 'cabos', 'alca', 'alça', 'alcas', 'alças'],
    produtoMatch: ['cabo', 'alca'],
  },
  {
    id: 'kit',
    nome: 'kit',
    aliases: ['kit', 'kits', 'kit feirinha', 'feirinha'],
    produtoMatch: ['kit', 'feirinha'],
  },
];

function limpar(valor) {
  if (valor === undefined || valor === null) return '';
  return String(valor).trim();
}

function normalizar(valor) {
  return limpar(valor)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[º°ª]/g, '')
    .replace(/c\s*\/\s*caixa/g, 'com caixa')
    .replace(/s\s*\/\s*caixa/g, 'sem caixa')
    .replace(/n[.\s]*([0-9]+)/g, 'n $1')
    .replace(/numero/g, 'n')
    .replace(/[^a-z0-9,.\/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(valor) {
  return normalizar(valor)
    .split(' ')
    .map((t) => t.trim())
    .filter(Boolean)
    .filter((t) => !STOPWORDS.has(t));
}

function formatarMoeda(valor) {
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return null;
  return numero.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function normalizarPreco(valor) {
  if (valor === undefined || valor === null || `${valor}`.trim() === '') return null;
  const numero = Number.parseFloat(`${valor}`.replace(',', '.'));
  if (!Number.isFinite(numero)) return null;
  return Math.round(numero * 100) / 100;
}

function primeiraFoto(produto) {
  if (produto?.foto) return produto.foto;
  if (Array.isArray(produto?.fotos)) {
    return produto.fotos.find((foto) => limpar(foto)) || null;
  }
  return null;
}

function mapearProduto(produto) {
  const preco = normalizarPreco(produto?.preco);
  const nome = limpar(produto?.nome);
  const precoFormatado = formatarMoeda(preco);
  return {
    id: produto?.id ?? null,
    nome,
    categoria: limpar(produto?.categoria),
    preco,
    precoFormatado,
    foto: primeiraFoto(produto),
    caption: precoFormatado ? `${nome} - ${precoFormatado}` : nome,
    capacidadeCaixa: produto?.capacidade_caixa ?? produto?.capacidadeCaixa ?? null,
    itemLegado: produto?.item_legado ?? produto?.itemLegado ?? null,
  };
}

function detectarBasePorAlias(textoNormalizado) {
  for (const base of BASES_CATALOGO) {
    for (const alias of base.aliases) {
      const aliasNorm = normalizar(alias);
      if (!aliasNorm) continue;
      if (aliasNorm === 'pressao') {
        if (/\bpressao\b/.test(textoNormalizado)) return base;
        continue;
      }
      if (textoNormalizado.includes(aliasNorm)) return base;
    }
  }
  return null;
}

function produtoPertenceBase(produto, base) {
  if (!base) return true;
  const nome = normalizar(`${produto?.nome || ''} ${produto?.categoria || ''}`);

  if (base.id === 'panela_pressao') {
    return nome.includes('pressao') && nome.includes('panela');
  }

  return base.produtoMatch.some((termo) => nome.includes(normalizar(termo)));
}

function detectarQuantidade(texto) {
  const bruto = limpar(texto);
  const padroes = [
    /\b(?:quero|preciso|comprar|manda|mande|orcamento de|orçamento de)\s+(\d{1,5})\b/i,
    /\b(\d{1,5})\s*(?:un|und|unid|unidade|unidades|peca|peça|pecas|peças)\b/i,
  ];
  for (const padrao of padroes) {
    const match = bruto.match(padrao);
    if (!match) continue;
    const numero = Number.parseInt(match[1], 10);
    if (Number.isInteger(numero) && numero > 0 && numero <= 100000) return numero;
  }
  return null;
}

function detectarCapacidades(texto) {
  const original = limpar(texto).toLowerCase();
  const n = normalizar(texto);
  const caps = [];

  function add(valor) {
    let textoCap = String(valor).replace(',', '.').trim();
    if (!textoCap) return;
    const num = Number.parseFloat(textoCap);
    if (Number.isFinite(num)) {
      textoCap = Number.isInteger(num) ? String(num) : String(num).replace(/0+$/, '').replace(/\.$/, '');
    }
    if (!caps.includes(textoCap)) caps.push(textoCap);
  }

  if (/\b(meio litro|meia litro|meio l)\b/.test(n) || /\b1\s*\/\s*2\s*l?\b/.test(original)) add('0.5');
  if (/\b(um|1) litro e meio\b/.test(n)) add('1.5');
  if (/\b(dois|2) litros? e meio\b/.test(n)) add('2.5');

  for (const match of n.matchAll(/\b(\d{2,4})\s*(ml|mililitros?|mili)\b/g)) {
    const ml = Number.parseInt(match[1], 10);
    if (Number.isInteger(ml) && ml >= 100 && ml <= 10000) add(String(ml / 1000));
  }

  for (const match of n.matchAll(/\b(\d{1,2})(?:[,.](\d{1,2}))?\s*(l|lt|lts|litro|litros)\b/g)) {
    if (match[2]) add(`${Number.parseInt(match[1], 10)}.${match[2]}`);
    else add(match[1]);
  }

  // Em frases de produto, "4.5" costuma significar litragem mesmo sem o L.
  if (/\b(cafeteira|pressao|panela)\b/.test(n)) {
    for (const match of n.matchAll(/\b(\d{1,2})[,.](\d{1,2})\b/g)) {
      add(`${Number.parseInt(match[1], 10)}.${match[2]}`);
    }
  }

  return caps;
}

function detectarNumeroModelo(texto) {
  const n = normalizar(texto);
  const match = n.match(/\bn\s*(\d{1,3})\b/) || n.match(/\bnumero\s*(\d{1,3})\b/);
  return match ? match[1] : null;
}

function detectarAtributos(mensagem, contexto = {}) {
  const n = normalizar(mensagem);
  let base = detectarBasePorAlias(n);
  const capacidades = detectarCapacidades(mensagem);
  const numeroModelo = detectarNumeroModelo(mensagem);
  const cores = [];
  const acabamentos = [];

  if (/\b(preta|preto)\b/.test(n)) cores.push('preta');
  if (/\b(vermelha|vermelho)\b/.test(n)) cores.push('vermelha');
  if (/\b(polida|polido)\b/.test(n)) acabamentos.push('polida');
  if (/\b(craqueada|craqueado|craq)\b/.test(n)) acabamentos.push('craqueada');

  const comCaixa = /\b(com caixa|c caixa)\b/.test(n);
  const semCaixa = /\b(sem caixa|s caixa)\b/.test(n);

  // Continuação de conversa: "e a de meio litro?", "tem com caixa?".
  if (!base && contexto?.produtoBase && (capacidades.length || numeroModelo || cores.length || acabamentos.length || comCaixa || semCaixa || /^\s*(e\s+a|e\s+o|a\s+de|o\s+de)/.test(n))) {
    base = BASES_CATALOGO.find((b) => b.id === contexto.produtoBase) || null;
  }

  return {
    textoNormalizado: n,
    produtoBase: base?.id || null,
    produtoBaseNome: base?.nome || null,
    capacidades,
    numeroModelo,
    cores: [...new Set(cores)],
    acabamentos: [...new Set(acabamentos)],
    comCaixa: comCaixa && !semCaixa,
    semCaixa,
    quantidade: detectarQuantidade(mensagem),
  };
}

function descricaoCapacidade(cap) {
  const num = Number.parseFloat(String(cap).replace(',', '.'));
  if (!Number.isFinite(num)) return `${cap}L`;
  if (num === 0.5) return '0,5L';
  if (Number.isInteger(num)) return `${num}L`;
  return `${String(num).replace('.', ',')}L`;
}

function descricaoSolicitacao(attrs) {
  const partes = [];
  if (attrs.produtoBaseNome) partes.push(attrs.produtoBaseNome);
  if (attrs.numeroModelo) partes.push(`nº ${attrs.numeroModelo}`);
  for (const cap of attrs.capacidades || []) partes.push(descricaoCapacidade(cap));
  for (const cor of attrs.cores || []) partes.push(cor);
  for (const acabamento of attrs.acabamentos || []) partes.push(acabamento);
  if (attrs.comCaixa) partes.push('com caixa');
  if (attrs.semCaixa) partes.push('sem caixa');
  return partes.join(' ').trim() || 'esse produto';
}

function produtoTemCapacidade(produto, cap) {
  const nome = normalizar(`${produto?.nome || ''} ${produto?.categoria || ''}`);
  const capTexto = String(cap).replace(',', '.');
  const numero = Number.parseFloat(capTexto);

  if (Number.isFinite(numero)) {
    const ml = Math.round(numero * 1000);
    if (nome.includes(`${ml} ml`) || nome.includes(`${ml}ml`)) return true;
  }

  if (numero === 0.5) {
    return /\b0[,. ]?5\s*l?\b/.test(nome) || /\b500\s*ml\b/.test(nome) || /\b1\s*2\s*l?\b/.test(nome) || nome.includes('meio litro');
  }

  if (Number.isFinite(numero)) {
    const inteiro = Math.trunc(numero);
    const decimal = String(numero).split('.')[1];
    if (decimal) {
      return new RegExp(`\\b${inteiro}[,. ]?${decimal}\\s*l?\\b`).test(nome);
    }
    return new RegExp(`\\b${inteiro}\\s*(l|litro|litros)\\b`).test(nome);
  }

  return false;
}

function produtoTemNumeroModelo(produto, numeroModelo) {
  if (!numeroModelo) return true;
  const nome = normalizar(`${produto?.nome || ''} ${produto?.categoria || ''}`);
  return new RegExp(`\\bn\\s*${numeroModelo}\\b`).test(nome) || new RegExp(`\\b${numeroModelo}\\b`).test(nome);
}

function produtoTemCaixa(produto, attrs) {
  const nome = normalizar(`${produto?.nome || ''} ${produto?.categoria || ''}`);
  if (attrs.comCaixa) return /\b(com caixa|c caixa)\b/.test(nome);
  if (attrs.semCaixa) return /\b(sem caixa|s caixa)\b/.test(nome);
  return true;
}

function produtoTemCores(produto, attrs) {
  if (!attrs.cores?.length) return true;
  const nome = normalizar(`${produto?.nome || ''} ${produto?.categoria || ''}`);
  return attrs.cores.every((cor) => nome.includes(normalizar(cor)) || (cor === 'preta' && nome.includes('preto')));
}

function produtoTemAcabamentos(produto, attrs) {
  if (!attrs.acabamentos?.length) return true;
  const nome = normalizar(`${produto?.nome || ''} ${produto?.categoria || ''}`);
  return attrs.acabamentos.every((acabamento) => {
    if (acabamento === 'craqueada') return nome.includes('craq') || nome.includes('craqueada') || nome.includes('craqueado');
    if (acabamento === 'polida') return nome.includes('polida') || nome.includes('polido');
    return nome.includes(normalizar(acabamento));
  });
}

function scoreProdutoTexto(produto, termos) {
  const nome = normalizar(`${produto?.nome || ''} ${produto?.categoria || ''}`);
  let score = 0;
  for (const termo of termos) {
    if (!termo) continue;
    if (nome.split(' ').includes(termo)) score += /^\d+$/.test(termo) ? 20 : 14;
    else if (nome.includes(termo)) score += /^\d+$/.test(termo) ? 8 : 5;
  }
  return score;
}

function inferirBasePorProdutos(mensagem, produtos) {
  const termos = tokens(mensagem);
  if (!termos.length) return null;

  let melhor = null;
  for (const base of BASES_CATALOGO) {
    const produtosBase = produtos.filter((p) => produtoPertenceBase(p, base));
    if (!produtosBase.length) continue;
    const score = Math.max(...produtosBase.map((p) => scoreProdutoTexto(p, termos)));
    if (!melhor || score > melhor.score) melhor = { base, score };
  }

  return melhor && melhor.score >= 10 ? melhor.base : null;
}

function aplicarFiltro(nomeFiltro, candidatos, attrs, fn, faltantes) {
  const filtrados = candidatos.filter((p) => fn(p, attrs));
  if (filtrados.length) return filtrados;
  faltantes.push(nomeFiltro);
  return candidatos;
}

function ordenarProdutos(produtos, attrs, mensagem) {
  const termos = tokens(mensagem);
  return [...produtos].sort((a, b) => {
    const scoreA = scoreProdutoTexto(a, termos) + scoreAtributos(a, attrs);
    const scoreB = scoreProdutoTexto(b, termos) + scoreAtributos(b, attrs);
    if (scoreB !== scoreA) return scoreB - scoreA;
    return limpar(a?.nome).localeCompare(limpar(b?.nome), 'pt-BR');
  });
}

function scoreAtributos(produto, attrs) {
  let score = 0;
  if (attrs.capacidades?.some((cap) => produtoTemCapacidade(produto, cap))) score += 80;
  if (attrs.numeroModelo && produtoTemNumeroModelo(produto, attrs.numeroModelo)) score += 70;
  if ((attrs.comCaixa || attrs.semCaixa) && produtoTemCaixa(produto, attrs)) score += 60;
  if (attrs.cores?.length && produtoTemCores(produto, attrs)) score += 30;
  if (attrs.acabamentos?.length && produtoTemAcabamentos(produto, attrs)) score += 30;
  return score;
}

function montarMensagem({ attrs, produtos, matchExato, faltantes, intencao }) {
  const baseNome = attrs.produtoBaseNome || 'produto';
  const solicitado = descricaoSolicitacao(attrs);

  if (!produtos.length) {
    if (attrs.produtoBaseNome) return `Não encontrei ${baseNome} no catálogo. Vou confirmar.`;
    return 'Não encontrei esse produto no catálogo. Vou confirmar.';
  }

  if (!matchExato) {
    if (faltantes.includes('capacidade')) return `Não temos ${solicitado} no catálogo. Vou te mandar as opções de ${baseNome} que temos.`;
    if (faltantes.includes('numeroModelo')) return `Não encontrei ${solicitado} no catálogo. Vou te mandar as opções de ${baseNome} que temos.`;
    if (faltantes.includes('caixa') || faltantes.includes('cor') || faltantes.includes('acabamento')) return `Não encontrei exatamente ${solicitado}. Vou te mandar as opções de ${baseNome} que temos.`;
    return `Não encontrei exatamente ${solicitado}. Vou te mandar opções próximas.`;
  }

  if (produtos.length === 1) {
    const p = mapearProduto(produtos[0]);
    const preco = p.precoFormatado || 'preço não cadastrado';
    if (attrs.quantidade && p.preco) {
      const total = formatarMoeda(p.preco * attrs.quantidade);
      return `${p.nome}: ${preco}. ${attrs.quantidade} unidade(s): ${total}.`;
    }
    return `${p.nome}: ${preco}. Qual quantidade?`;
  }

  if (intencao === 'disponibilidade') {
    return `Sim, trabalhamos com ${baseNome}. Vou te mandar algumas opções.`;
  }

  return `Temos estas opções de ${baseNome}. Vou te mandar as fotos com os preços.`;
}

function detectarIntencao(mensagem) {
  const n = normalizar(mensagem);
  if (/\b(quanto|preco|preço|valor|custa|orcamento|orçamento)\b/.test(n)) return 'preco';
  if (/\b(tem|trabalha|trabalham|vende|vendem|existe|temos)\b/.test(n)) return 'disponibilidade';
  return 'catalogo';
}

function parecePerguntaCatalogo(attrs, mensagem) {
  if (attrs.produtoBase) return true;
  if (attrs.capacidades?.length || attrs.numeroModelo || attrs.comCaixa || attrs.semCaixa || attrs.cores?.length || attrs.acabamentos?.length) {
    return Boolean(attrs.produtoBase);
  }
  const termos = tokens(mensagem);
  return termos.length > 0 && /(preco|preço|valor|custa|tem|trabalha|vende|produto)/i.test(mensagem);
}

async function resolverCatalogo({ mensagem, telefone, contexto } = {}) {
  const texto = limpar(mensagem);
  const ctx = contexto && typeof contexto === 'object' ? contexto : {};
  let attrs = detectarAtributos(texto, ctx);
  const intencao = detectarIntencao(texto);

  const produtosAtivos = await produtoService.listar({ apenasAtivos: true });

  if (!attrs.produtoBase) {
    const baseInferida = inferirBasePorProdutos(texto, produtosAtivos);
    if (baseInferida) {
      attrs = {
        ...attrs,
        produtoBase: baseInferida.id,
        produtoBaseNome: baseInferida.nome,
      };
    }
  }

  if (!parecePerguntaCatalogo(attrs, texto)) {
    return {
      ok: true,
      tratado: false,
      intencao: 'fora_catalogo',
      mensagem: '',
      produtos: [],
      contextoAtualizado: ctx,
    };
  }

  const base = BASES_CATALOGO.find((b) => b.id === attrs.produtoBase) || null;
  let candidatos = produtosAtivos;

  if (base) {
    candidatos = produtosAtivos.filter((produto) => produtoPertenceBase(produto, base));
  } else {
    const termos = tokens(texto);
    candidatos = produtosAtivos
      .map((produto) => ({ produto, score: scoreProdutoTexto(produto, termos) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((item) => item.produto);
  }

  const existeCategoria = candidatos.length > 0;
  const faltantes = [];

  if (attrs.capacidades?.length) {
    candidatos = aplicarFiltro('capacidade', candidatos, attrs, (p, a) => a.capacidades.every((cap) => produtoTemCapacidade(p, cap)), faltantes);
  }

  if (attrs.numeroModelo) {
    candidatos = aplicarFiltro('numeroModelo', candidatos, attrs, (p, a) => produtoTemNumeroModelo(p, a.numeroModelo), faltantes);
  }

  if (attrs.comCaixa || attrs.semCaixa) {
    candidatos = aplicarFiltro('caixa', candidatos, attrs, produtoTemCaixa, faltantes);
  }

  if (attrs.cores?.length) {
    candidatos = aplicarFiltro('cor', candidatos, attrs, produtoTemCores, faltantes);
  }

  if (attrs.acabamentos?.length) {
    candidatos = aplicarFiltro('acabamento', candidatos, attrs, produtoTemAcabamentos, faltantes);
  }

  const matchExato = faltantes.length === 0 && existeCategoria;
  const ordenados = ordenarProdutos(candidatos, attrs, texto);

  // Quando todos os filtros bateram e a pergunta é específica, reduz a lista.
  const perguntaEspecifica = Boolean(
    attrs.capacidades?.length || attrs.numeroModelo || attrs.comCaixa || attrs.semCaixa || attrs.cores?.length || attrs.acabamentos?.length
  );
  const limite = perguntaEspecifica && matchExato ? 3 : 5;
  const produtosSelecionados = ordenados.slice(0, limite);
  const produtosMapeados = produtosSelecionados.map(mapearProduto);
  const mensagemFinal = montarMensagem({ attrs, produtos: produtosSelecionados, matchExato, faltantes, intencao });
  const textoAntesProdutos = !matchExato && produtosMapeados.length ? mensagemFinal : '';

  const contextoAtualizado = {
    produtoBase: attrs.produtoBase || ctx.produtoBase || null,
    produtoBaseNome: attrs.produtoBaseNome || ctx.produtoBaseNome || null,
    atributos: attrs,
    ultimaMensagem: texto,
    atualizadoEm: new Date().toISOString(),
  };

  return {
    ok: true,
    tratado: true,
    intencao,
    produtoBase: attrs.produtoBase,
    produtoBaseNome: attrs.produtoBaseNome,
    atributosDetectados: attrs,
    existeCategoria,
    existeExato: matchExato,
    matchExatoProduto: matchExato,
    filtrosFaltantes: faltantes,
    totalCategoria: base ? produtosAtivos.filter((produto) => produtoPertenceBase(produto, base)).length : ordenados.length,
    totalRetornado: produtosMapeados.length,
    mensagem: mensagemFinal,
    resposta: mensagemFinal,
    tipoResposta: produtosMapeados.length ? 'produtos' : 'texto',
    enviarComoImagem: produtosMapeados.some((produto) => produto.foto),
    enviarTextoAntesProdutos: Boolean(textoAntesProdutos),
    textoAntesProdutos,
    produtos: produtosMapeados,
    contextoAtualizado,
  };
}

module.exports = {
  resolverCatalogo,
  // exports úteis para testes futuros
  _internals: {
    normalizar,
    detectarAtributos,
    detectarCapacidades,
    descricaoSolicitacao,
  },
};
