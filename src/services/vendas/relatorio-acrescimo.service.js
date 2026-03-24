function normalizarQuebras(texto) {
  return String(texto || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();
}

function parseValorMonetario(valor) {
  if (valor === null || valor === undefined) return NaN;

  if (typeof valor === 'number') {
    return valor;
  }

  const texto = String(valor)
    .trim()
    .replace(/\s/g, '')
    .replace(/\./g, '')
    .replace(',', '.');

  const numero = Number(texto);
  return Number.isFinite(numero) ? numero : NaN;
}

function paraCentavos(valor) {
  return Math.round(valor * 100);
}

function formatarMoedaBR(valorEmReais) {
  return Number(valorEmReais).toFixed(2).replace('.', ',');
}

function formatarCentavosBR(valorEmCentavos) {
  return formatarMoedaBR(valorEmCentavos / 100);
}

function extrairItensDoRelatorio(relatorio) {
  const texto = normalizarQuebras(relatorio);

  const regexItem =
    /•\s*(.*?)\s*\|\s*QTD:\s*(\d+)\s*\n\s*UNIT:\s*R\$\s*([\d.,]+)\s*\n\s*SUBTOTAL:\s*R\$\s*([\d.,]+)(?=\n\s*\n|$)/g;

  const itens = [];
  let match;

  while ((match = regexItem.exec(texto)) !== null) {
    const nome = match[1].trim();
    const qtdOriginal = Number(match[2]);
    const unitOriginal = parseValorMonetario(match[3]);
    const subtotalOriginal = parseValorMonetario(match[4]);

    if (!nome) {
      throw new Error('Foi encontrado um item com nome vazio no relatório.');
    }

    if (!Number.isInteger(qtdOriginal) || qtdOriginal <= 0) {
      throw new Error(`Quantidade inválida no item "${nome}".`);
    }

    if (!Number.isFinite(unitOriginal) || unitOriginal < 0) {
      throw new Error(`UNIT inválido no item "${nome}".`);
    }

    if (!Number.isFinite(subtotalOriginal) || subtotalOriginal < 0) {
      throw new Error(`SUBTOTAL inválido no item "${nome}".`);
    }

    itens.push({
      nome,
      qtdOriginal,
      unitOriginal,
      unitOriginalCentavos: paraCentavos(unitOriginal),
      subtotalOriginal,
      subtotalOriginalCentavos: paraCentavos(subtotalOriginal)
    });
  }

  if (!itens.length) {
    throw new Error(
      'Nenhum item foi encontrado no relatório. Verifique se ele está no formato padrão do sistema.'
    );
  }

  return itens;
}

function distribuirExtraExato(totalExtraCentavos, totalUnidades) {
  const basePorUnidade = Math.floor(totalExtraCentavos / totalUnidades);
  let resto = totalExtraCentavos % totalUnidades;

  return function calcularExtraDoItem(quantidadeDoItem) {
    const centavosExtrasPorResto = Math.min(resto, quantidadeDoItem);
    resto -= centavosExtrasPorResto;

    return (quantidadeDoItem * basePorUnidade) + centavosExtrasPorResto;
  };
}

function gerarRelatorioComAcrescimo({ relatorio, valorExtra, multiplicador }) {
  const itensOriginais = extrairItensDoRelatorio(relatorio);

  const valorExtraNumero = parseValorMonetario(valorExtra);
  const multiplicadorNumero = Number(multiplicador);

  if (!Number.isFinite(valorExtraNumero) || valorExtraNumero < 0) {
    throw new Error('O campo valorExtra precisa ser um número válido maior ou igual a zero.');
  }

  if (!Number.isInteger(multiplicadorNumero) || multiplicadorNumero <= 0) {
    throw new Error('O campo multiplicador precisa ser um inteiro maior que zero.');
  }

  const valorExtraCentavos = paraCentavos(valorExtraNumero);

  const itensComQuantidadeNova = itensOriginais.map((item) => {
    const qtdNova = item.qtdOriginal * multiplicadorNumero;

    return {
      ...item,
      qtdNova,
      subtotalBaseMultiplicadoCentavos: item.subtotalOriginalCentavos * multiplicadorNumero
    };
  });

  const totalUnidadesNovas = itensComQuantidadeNova.reduce((acc, item) => acc + item.qtdNova, 0);

  if (totalUnidadesNovas <= 0) {
    throw new Error('O total de unidades após aplicar o multiplicador ficou inválido.');
  }

  const calcularExtraDoItem = distribuirExtraExato(valorExtraCentavos, totalUnidadesNovas);

  const itensProcessados = itensComQuantidadeNova.map((item) => {
    const extraItemCentavos = calcularExtraDoItem(item.qtdNova);
    const subtotalNovoCentavos = item.subtotalBaseMultiplicadoCentavos + extraItemCentavos;
    const unitNovoMedio = subtotalNovoCentavos / 100 / item.qtdNova;

    return {
      nome: item.nome,
      qtdOriginal: item.qtdOriginal,
      qtdNova: item.qtdNova,
      unitOriginal: item.unitOriginal,
      subtotalOriginal: item.subtotalOriginal,
      extraItemCentavos,
      unitNovoMedio,
      subtotalNovoCentavos
    };
  });

  const totalOriginalCentavos = itensOriginais.reduce(
    (acc, item) => acc + item.subtotalOriginalCentavos,
    0
  );

  const totalFinalCentavos = itensProcessados.reduce(
    (acc, item) => acc + item.subtotalNovoCentavos,
    0
  );

  const relatorioFinal = [
    '📦 RELATÓRIO ALUMÍNIO JR',
    '',
    ...itensProcessados.flatMap((item) => [
      `• ${item.nome} | QTD: ${item.qtdNova}`,
      `  UNIT: R$ ${formatarMoedaBR(item.unitNovoMedio)}`,
      `  SUBTOTAL: R$ ${formatarCentavosBR(item.subtotalNovoCentavos)}`,
      ''
    ]),
    `Valor total: R$ ${formatarCentavosBR(totalFinalCentavos)}`
  ].join('\n');

  return {
    valorExtraInformado: formatarCentavosBR(valorExtraCentavos),
    multiplicador: multiplicadorNumero,
    totalUnidadesNovas,
    totalOriginal: formatarCentavosBR(totalOriginalCentavos),
    totalFinal: formatarCentavosBR(totalFinalCentavos),
    relatorio: relatorioFinal,
    itens: itensProcessados.map((item) => ({
      nome: item.nome,
      qtdOriginal: item.qtdOriginal,
      qtdNova: item.qtdNova,
      unitOriginal: formatarMoedaBR(item.unitOriginal),
      unitNovo: formatarMoedaBR(item.unitNovoMedio),
      subtotalOriginal: formatarMoedaBR(item.subtotalOriginal),
      subtotalNovo: formatarCentavosBR(item.subtotalNovoCentavos),
      extraAplicadoNoItem: formatarCentavosBR(item.extraItemCentavos)
    })),
    observacao:
      'No fechamento exato, o UNIT exibido é a média arredondada em 2 casas. O SUBTOTAL e o Valor total são os valores monetários de referência.'
  };
}

module.exports = {
  gerarRelatorioComAcrescimo
};
