const produtoService = require('../produto/produto.service');
const zapiService = require('../integracoes/zapi.service');

function limparTexto(valor) {
  return String(valor || '').replace(/\s+/g, ' ').trim();
}

function normalizarNome(valor) {
  return limparTexto(valor)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function parseNumeroBR(valor) {
  const texto = String(valor || '')
    .replace(/[^\d,.-]/g, '')
    .trim();

  if (!texto) return 0;

  const normalizado = texto.includes(',')
    ? texto.replace(/\./g, '').replace(',', '.')
    : texto;

  const numero = Number.parseFloat(normalizado);
  return Number.isFinite(numero) ? numero : 0;
}

function arredondar(valor, casas = 2) {
  const fator = 10 ** casas;
  return Math.round((Number(valor || 0) + Number.EPSILON) * fator) / fator;
}

function formatarMoeda(valor) {
  return Number(valor || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function formatarQuantidade(valor) {
  const numero = Number(valor || 0);

  if (Number.isInteger(numero)) {
    return String(numero);
  }

  return numero.toLocaleString('pt-BR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4
  });
}

function normalizarMultiplicador(valor) {
  const multiplicador = Number.parseInt(valor, 10);

  if (!Number.isInteger(multiplicador) || multiplicador < 1) {
    throw new Error('O multiplicador deve ser um número inteiro maior ou igual a 1.');
  }

  if (multiplicador > 999) {
    throw new Error('O multiplicador máximo permitido é 999.');
  }

  return multiplicador;
}

function normalizarTelefoneBrasil(telefone) {
  const digitos = String(telefone || '').replace(/\D+/g, '');

  if (!digitos) {
    throw new Error('O cliente selecionado não possui telefone cadastrado.');
  }

  if (digitos.startsWith('55') && digitos.length >= 12) {
    return digitos;
  }

  if (digitos.length === 10 || digitos.length === 11) {
    return `55${digitos}`;
  }

  if (digitos.length < 10) {
    throw new Error('O telefone cadastrado para o cliente é inválido.');
  }

  return digitos;
}

function extrairRelatorio(textoRelatorio) {
  const texto = String(textoRelatorio || '').trim();

  if (!texto) {
    throw new Error('Cole o relatório do Kit Feirinha ou do Orçamento.');
  }

  const linhas = texto.split(/\r?\n/);
  const itens = [];
  let itemAtual = null;
  let totalRelatorio = null;

  function concluirItemAtual() {
    if (!itemAtual) return;

    if (!itemAtual.nome || itemAtual.quantidade <= 0) {
      itemAtual = null;
      return;
    }

    if (itemAtual.unitario <= 0 && itemAtual.subtotal > 0) {
      itemAtual.unitario = arredondar(itemAtual.subtotal / itemAtual.quantidade, 4);
    }

    if (itemAtual.subtotal <= 0 && itemAtual.unitario >= 0) {
      itemAtual.subtotal = arredondar(itemAtual.unitario * itemAtual.quantidade, 2);
    }

    itens.push(itemAtual);
    itemAtual = null;
  }

  linhas.forEach((linhaOriginal) => {
    const linha = String(linhaOriginal || '').trim();
    if (!linha) return;

    const itemMatch = linha.match(/^[•\-*]?\s*(.+?)\s*\|\s*QTD\s*:\s*([0-9]+(?:[,.][0-9]+)?)/i);

    if (itemMatch) {
      concluirItemAtual();
      itemAtual = {
        nome: limparTexto(itemMatch[1]),
        quantidade: parseNumeroBR(itemMatch[2]),
        unitario: 0,
        subtotal: 0
      };
      return;
    }

    const totalMatch = linha.match(/^Valor\s+total\s*:\s*R?\$?\s*(.+)$/i);
    if (totalMatch) {
      totalRelatorio = parseNumeroBR(totalMatch[1]);
      return;
    }

    if (!itemAtual) return;

    const unitarioMatch = linha.match(/^UNIT\s*:\s*R?\$?\s*(.+)$/i);
    if (unitarioMatch) {
      itemAtual.unitario = parseNumeroBR(unitarioMatch[1]);
      return;
    }

    const subtotalMatch = linha.match(/^SUBTOTAL\s*:\s*R?\$?\s*(.+)$/i);
    if (subtotalMatch) {
      itemAtual.subtotal = parseNumeroBR(subtotalMatch[1]);
    }
  });

  concluirItemAtual();

  if (!itens.length) {
    throw new Error('Nenhum item foi identificado. Use o relatório original gerado pelo Kit Feirinha ou pelo Orçamento.');
  }

  const totalCalculado = arredondar(
    itens.reduce((total, item) => total + Number(item.subtotal || 0), 0),
    2
  );

  return {
    itens,
    total: totalRelatorio === null ? totalCalculado : arredondar(totalRelatorio, 2)
  };
}

function imagemValidaParaZapi(valor) {
  const imagem = String(valor || '').trim();

  if (!imagem) return false;
  if (/^data:image\/(jpeg|jpg|png|webp);base64,/i.test(imagem)) return true;

  try {
    const url = new URL(imagem);
    return ['http:', 'https:'].includes(url.protocol);
  } catch (_) {
    return false;
  }
}

function selecionarFoto(produto) {
  const fotos = Array.isArray(produto?.fotos)
    ? produto.fotos
    : [produto?.foto, produto?.foto_2, produto?.foto_3, produto?.foto_4, produto?.foto_5, produto?.foto_6];

  return fotos
    .map(foto => String(foto || '').trim())
    .find(imagemValidaParaZapi) || '';
}

function criarIndiceProdutos(produtos) {
  const indice = new Map();

  produtos.forEach((produto) => {
    const chave = normalizarNome(produto?.nome);
    if (!chave) return;

    if (!indice.has(chave)) {
      indice.set(chave, []);
    }

    indice.get(chave).push(produto);
  });

  return indice;
}

function localizarProduto(nomeRelatorio, produtos, indiceProdutos) {
  const chave = normalizarNome(nomeRelatorio);
  const exatos = indiceProdutos.get(chave) || [];

  if (exatos.length === 1) {
    return exatos[0];
  }

  const aproximados = produtos.filter((produto) => {
    const chaveProduto = normalizarNome(produto?.nome);
    return chaveProduto && (chaveProduto.includes(chave) || chave.includes(chaveProduto));
  });

  return aproximados.length === 1 ? aproximados[0] : null;
}

async function analisarRelatorio({ relatorio, multiplicador }) {
  const multiplicadorNormalizado = normalizarMultiplicador(multiplicador);
  const relatorioExtraido = extrairRelatorio(relatorio);
  const produtos = await produtoService.listar({ apenasAtivos: true });
  const indiceProdutos = criarIndiceProdutos(produtos);

  const itens = relatorioExtraido.itens.map((item, index) => {
    const produto = localizarProduto(item.nome, produtos, indiceProdutos);
    const foto = selecionarFoto(produto);
    const quantidadeFinal = arredondar(item.quantidade * multiplicadorNormalizado, 4);
    const subtotalFinal = arredondar(item.subtotal * multiplicadorNormalizado, 2);
    let problema = '';

    if (!produto) {
      problema = 'Produto não localizado no cadastro do PostgreSQL.';
    } else if (!foto) {
      problema = 'Produto localizado, mas está sem foto cadastrada.';
    }

    return {
      ordem: index + 1,
      nomeRelatorio: item.nome,
      produtoId: produto?.id || null,
      descricao: produto?.nome || item.nome,
      foto,
      quantidadeOriginal: item.quantidade,
      quantidadeFinal,
      unitario: arredondar(item.unitario, 4),
      subtotalOriginal: arredondar(item.subtotal, 2),
      subtotalFinal,
      encontrado: Boolean(produto),
      possuiFoto: Boolean(foto),
      pronto: Boolean(produto && foto),
      problema
    };
  });

  const pendencias = itens.filter(item => !item.pronto);

  return {
    multiplicador: multiplicadorNormalizado,
    quantidadeProdutos: itens.length,
    quantidadeTotalOriginal: arredondar(
      relatorioExtraido.itens.reduce((total, item) => total + item.quantidade, 0),
      4
    ),
    quantidadeTotalFinal: arredondar(
      relatorioExtraido.itens.reduce((total, item) => total + item.quantidade, 0) * multiplicadorNormalizado,
      4
    ),
    totalOriginal: relatorioExtraido.total,
    totalFinal: arredondar(relatorioExtraido.total * multiplicadorNormalizado, 2),
    prontoParaEnvio: pendencias.length === 0,
    pendencias: pendencias.map(item => ({
      ordem: item.ordem,
      nome: item.nomeRelatorio,
      problema: item.problema
    })),
    itens
  };
}

function validarNumeroNaoNegativo(valor, nomeCampo) {
  const numero = Number(valor);

  if (!Number.isFinite(numero) || numero < 0) {
    throw new Error(`${nomeCampo} inválido.`);
  }

  return numero;
}

function validarInteiroPositivo(valor, nomeCampo) {
  const numero = Number.parseInt(valor, 10);

  if (!Number.isInteger(numero) || numero < 1) {
    throw new Error(`${nomeCampo} inválido.`);
  }

  return numero;
}

async function enviarItem(payload = {}) {
  const telefone = normalizarTelefoneBrasil(payload.telefone);
  const produtoId = validarInteiroPositivo(payload.produtoId, 'Produto');
  const quantidade = validarNumeroNaoNegativo(payload.quantidade, 'Quantidade');
  const unitario = validarNumeroNaoNegativo(payload.unitario, 'Valor unitário');
  const subtotal = validarNumeroNaoNegativo(payload.subtotal, 'Subtotal');
  const indice = validarInteiroPositivo(payload.indice, 'Índice do item');
  const totalItens = validarInteiroPositivo(payload.totalItens, 'Total de itens');
  const produto = await produtoService.buscar(produtoId);
  const foto = selecionarFoto(produto);

  if (!produto.ativo) {
    throw new Error(`O produto ${produto.nome} está inativo.`);
  }

  if (!foto) {
    throw new Error(`O produto ${produto.nome} está sem foto cadastrada.`);
  }

  const legenda = [
    `📦 Item ${indice} de ${totalItens}`,
    '',
    produto.nome,
    `Quantidade: ${formatarQuantidade(quantidade)}`,
    `Valor unitário: R$ ${formatarMoeda(unitario)}`,
    `Subtotal: R$ ${formatarMoeda(subtotal)}`
  ].join('\n');

  const resultado = await zapiService.enviarImagem({
    telefone,
    imagem: foto,
    legenda
  });

  return {
    telefone,
    produtoId: produto.id,
    descricao: produto.nome,
    foto,
    quantidade,
    unitario,
    subtotal,
    indice,
    totalItens,
    zapi: resultado.zapi || resultado
  };
}

async function finalizarEnvio(payload = {}) {
  const telefone = normalizarTelefoneBrasil(payload.telefone);
  const total = validarNumeroNaoNegativo(payload.total, 'Valor total');
  const quantidadeProdutos = validarInteiroPositivo(payload.quantidadeProdutos, 'Quantidade de produtos');
  const multiplicador = normalizarMultiplicador(payload.multiplicador);

  const mensagem = [
    '✅ Relatório com fotos concluído',
    '',
    `Produtos enviados: ${quantidadeProdutos}`,
    `Multiplicador: ${multiplicador}x`,
    `Valor total: R$ ${formatarMoeda(total)}`
  ].join('\n');

  const resultado = await zapiService.enviarTexto({ telefone, mensagem });

  return {
    telefone,
    total,
    quantidadeProdutos,
    multiplicador,
    mensagem,
    zapi: resultado.zapi || resultado
  };
}

module.exports = {
  analisarRelatorio,
  enviarItem,
  finalizarEnvio,
  extrairRelatorio,
  normalizarTelefoneBrasil,
  formatarMoeda,
  formatarQuantidade
};
