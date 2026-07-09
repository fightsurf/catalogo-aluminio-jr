(function (window) {
  'use strict';

  const TITULO_BASE = '📦 RELATÓRIO ALUMÍNIO JR';

  function parseNumeroBR(valor) {
    const texto = String(valor || '')
      .replace(/[^\d,.-]/g, '')
      .replace(/\./g, '')
      .replace(',', '.');

    const numero = Number.parseFloat(texto);
    return Number.isFinite(numero) ? numero : 0;
  }

  function formatarMoeda(valor) {
    const numero = Number(valor || 0);
    return numero.toFixed(2).replace('.', ',');
  }

  function formatarQuantidade(valor) {
    const numero = Number(valor || 0);

    if (Number.isInteger(numero)) {
      return String(numero);
    }

    return String(numero)
      .replace('.', ',')
      .replace(/,?0+$/, '');
  }

  function obterQuantidade(item) {
    return Number(item?.qtd ?? item?.quantidade ?? 0) || 0;
  }

  function calcularTotalItens(itens) {
    return (Array.isArray(itens) ? itens : []).reduce((total, item) => total + obterQuantidade(item), 0);
  }

  function montarTitulo(itens) {
    const totalItens = calcularTotalItens(itens);
    const quantidade = formatarQuantidade(totalItens);
    const itemTexto = totalItens === 1 ? 'ITEM ESCOLHIDO' : 'ITENS ESCOLHIDOS';

    return `${TITULO_BASE} - ${quantidade} ${itemTexto}`;
  }

  function montarRelatorio(opcoes) {
    const itens = Array.isArray(opcoes?.itens) ? opcoes.itens : [];
    const total = Number(opcoes?.total || 0);

    let texto = `${montarTitulo(itens)}\n\n`;

    itens.forEach((item, index) => {
      const nome = String(item?.nome || '').trim();
      const qtd = obterQuantidade(item);
      const preco = Number(item?.preco ?? item?.unitario ?? 0);
      const subtotal = Number(item?.subtotal ?? (qtd * preco));

      texto += `• ${nome} | QTD: ${formatarQuantidade(qtd)}\n`;
      texto += `  UNIT: R$ ${formatarMoeda(preco)}\n`;
      texto += `  SUBTOTAL: R$ ${formatarMoeda(subtotal)}`;

      if (index < itens.length - 1) {
        texto += `\n\n`;
      }
    });

    texto += `\n\nValor total: R$ ${formatarMoeda(total)}`;
    return texto;
  }

  function normalizarNome(nome) {
    return String(nome || '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function chaveNome(nome) {
    return normalizarNome(nome)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase();
  }

  function extrairItens(texto) {
    const linhas = String(texto || '').split(/\r?\n/);
    const itensPorNome = new Map();

    linhas.forEach((linha) => {
      const match = linha.match(/^\s*[•\-*]?\s*(.+?)\s*\|\s*QTD\s*:\s*([0-9]+(?:[,.][0-9]+)?)/i);
      if (!match) return;

      const nome = normalizarNome(match[1]);
      const qtd = parseNumeroBR(match[2]);
      const chave = chaveNome(nome);

      if (!nome || !qtd || qtd <= 0 || !chave) return;

      const existente = itensPorNome.get(chave);

      if (existente) {
        existente.qtd += qtd;
      } else {
        itensPorNome.set(chave, { nome, qtd });
      }
    });

    return Array.from(itensPorNome.values());
  }

  window.RelatorioAluminioJR = {
    TITULO_BASE,
    montarTitulo,
    montarRelatorio,
    extrairItens,
    calcularTotalItens
  };
})(window);
