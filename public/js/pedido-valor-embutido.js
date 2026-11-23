(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PedidoValorEmbutido = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function numero(valor, nome) {
    const n = Number(valor);
    if (valor === null || valor === undefined || valor === '' || typeof valor === 'boolean' || !Number.isFinite(n)) {
      throw new Error(`${nome} inválido.`);
    }
    return n;
  }

  function arredondar(valor, casas = 3) {
    const fator = 10 ** casas;
    return Math.round((valor + Number.EPSILON * Math.max(1, Math.abs(valor))) * fator) / fator;
  }

  function codigo(item) {
    return Number(item.item ?? item.item_legado ?? item.itemLegado) || null;
  }

  function precoBase(item) {
    return numero(item.__valorEmbutido?.precoBase ?? item.preco, 'Preço-base');
  }

  function validarLimite(n, nome) {
    if (!Number.isSafeInteger(n)) throw new Error(`${nome} acima do limite permitido.`);
    return n;
  }

  function simular(itens, valor) {
    if (!Array.isArray(itens)) throw new Error('Informe os itens do pedido.');
    valor = arredondar(numero(valor, 'Valor a embutir'), 2);
    if (valor <= 0) throw new Error('O produto escolhido precisa ter preço maior que zero.');
    const valorCentavos = validarLimite(Math.round(valor * 100), 'Valor a embutir');
    const quantidadeTotal = itens.reduce((soma, item) => {
      const quantidade = numero(item.quantidade, 'Quantidade');
      if (quantidade <= 0) throw new Error('As quantidades devem ser maiores que zero.');
      if (!Number.isSafeInteger(quantidade)) throw new Error('Para embutir um valor, informe quantidades em unidades inteiras.');
      return validarLimite(soma + quantidade, 'Quantidade total');
    }, 0);
    // O mesmo acréscimo é aplicado a todas as unidades. Arredondar para cima
    // mantém os preços em centavos, sem dividir um produto em duas linhas.
    const acrescimoCentavos = quantidadeTotal ? Math.ceil(valorCentavos / quantidadeTotal) : 0;
    const totalCentavos = validarLimite(acrescimoCentavos * quantidadeTotal, 'Total a embutir');
    return {
      quantidadeTotal,
      acrescimoUnitario: acrescimoCentavos / 100,
      acrescimoUnitarioMaximo: acrescimoCentavos / 100,
      unidadesCentavoExtra: 0,
      totalDistribuido: totalCentavos / 100,
      diferenca: arredondar((totalCentavos - valorCentavos) / 100, 2)
    };
  }

  function serializar(itens, metadata) {
    if (!metadata) return null;
    const linhas = itens.map((item) => {
      const base = arredondar(precoBase(item));
      const preco = arredondar(numero(item.preco, 'Preço'));
      const quantidade = numero(item.quantidade, 'Quantidade');
      if (base < 0 || quantidade <= 0 || preco < base) throw new Error('Os preços e quantidades do valor embutido são inválidos.');
      return {
        item: codigo(item),
        saidaItem: item.saidaItem ?? null,
        sequencia: item.sequencia ?? null,
        quantidade,
        precoBase: base,
        precoAplicado: preco,
        acrescimoUnitario: arredondar(preco - base)
      };
    });
    const quantidadeTotal = arredondar(linhas.reduce((s, linha) => s + linha.quantidade, 0), 6);
    const totalDistribuido = arredondar(linhas.reduce((s, linha) => s + linha.quantidade * linha.acrescimoUnitario, 0), 2);
    const minimo = linhas.length ? Math.min(...linhas.map(linha => linha.acrescimoUnitario)) : 0;
    const maximo = linhas.length ? Math.max(...linhas.map(linha => linha.acrescimoUnitario)) : 0;
    return {
      versao: 1,
      produto: { ...metadata.produto },
      valor: metadata.valor,
      quantidadeTotal,
      acrescimoUnitario: minimo,
      acrescimoUnitarioMaximo: maximo,
      unidadesCentavoExtra: maximo > minimo ? linhas.reduce((s, linha) => s + (linha.acrescimoUnitario === maximo ? linha.quantidade : 0), 0) : 0,
      totalDistribuido,
      diferenca: arredondar(totalDistribuido - metadata.valor, 2),
      linhas
    };
  }

  function clonar(item) {
    const copia = { ...item };
    if (item.__valorEmbutido) copia.__valorEmbutido = { ...item.__valorEmbutido };
    return copia;
  }

  function atualizarSubtotal(item) {
    if (Object.prototype.hasOwnProperty.call(item, 'subtotal')) item.subtotal = arredondar(item.quantidade * item.preco, 2);
    if (Object.prototype.hasOwnProperty.call(item, 'subtotalitem')) item.subtotalitem = arredondar(item.quantidade * item.preco, 2);
  }

  // Preço-base e os demais campos comerciais fazem parte da chave. IDs de
  // detalhes são recriados no legado e não devem impedir reunir partes do rateio.
  function chaveBase(item, base) {
    const ignorados = new Set(['quantidade', 'preco', '__valorEmbutido', 'saidaItem', 'sequencia', 'subtotal', 'subtotalitem']);
    return JSON.stringify([base, Object.keys(item).filter(k => !ignorados.has(k)).sort().map(k => [k, item[k]])]);
  }

  function agruparBases(itens) {
    const grupos = new Map();
    itens.forEach(item => {
      const base = arredondar(precoBase(item));
      const chave = chaveBase(item, base);
      let grupo = grupos.get(chave);
      if (!grupo) {
        grupo = { item: clonar(item), base, quantidade: 0 };
        grupos.set(chave, grupo);
      }
      grupo.quantidade += numero(item.quantidade, 'Quantidade');
    });
    return Array.from(grupos.values());
  }

  function recalcular(itens, metadata) {
    if (!metadata) return null;
    const resumo = simular(itens, metadata.valor);
    // Validar e produzir uma lista independente antes do splice. Nenhuma falha
    // deixa preços ou quantidades parcialmente alterados.
    const grupos = agruparBases(itens);
    grupos.forEach(({ base, quantidade }) => {
      if (base < 0) throw new Error('O preço-base não pode ser negativo. Retire o valor embutido para revisar esse preço.');
      const centavos = Math.round(base * 100);
      if (Math.abs(base * 100 - centavos) > 0.000001) {
        throw new Error('Para recalcular o valor embutido, os preços-base precisam ter no máximo duas casas decimais. Retire o valor embutido para revisar os preços.');
      }
      validarLimite(centavos, 'Preço-base');
      validarLimite(centavos * quantidade, 'Total do pedido');
    });
    const acrescimoCentavos = Math.round(resumo.acrescimoUnitario * 100);
    const novasLinhas = grupos.map(grupo => {
      const item = clonar(grupo.item);
      const precoCentavos = validarLimite(Math.round(grupo.base * 100) + acrescimoCentavos, 'Preço');
      validarLimite(precoCentavos * grupo.quantidade, 'Total do pedido');
      item.quantidade = grupo.quantidade;
      item.preco = precoCentavos / 100;
      item.__valorEmbutido = { precoBase: grupo.base, acrescimoUnitario: acrescimoCentavos / 100 };
      atualizarSubtotal(item);
      return item;
    });
    const estado = serializar(novasLinhas, metadata);
    if (novasLinhas.length && (estado.totalDistribuido !== resumo.totalDistribuido || estado.diferenca !== resumo.diferenca)) {
      throw new Error('Não foi possível aplicar o acréscimo uniforme. Confira os preços e quantidades.');
    }
    itens.splice(0, itens.length, ...novasLinhas);
    return estado;
  }

  function carregar(itens, metadata) {
    if (!metadata) return null;
    if (metadata.versao !== 1 || !Array.isArray(metadata.linhas) || !metadata.linhas.length) {
      throw new Error('Não foi possível conferir o valor embutido. Recarregue o pedido antes de editar.');
    }
    const disponiveis = metadata.linhas.slice();
    const planos = itens.map(item => {
      const preco = numero(item.preco, 'Preço');
      const quantidade = numero(item.quantidade, 'Quantidade');
      // Somente uma linha que ainda corresponda ao snapshot pode ser restaurada.
      // Um preço editado externamente não autoriza subtrair um acréscimo antigo.
      const indice = disponiveis.findIndex(linha => Number(linha.item) === codigo(item)
        && Math.abs(Number(linha.precoAplicado) - preco) < 0.000001
        && Math.abs(Number(linha.quantidade) - quantidade) < 0.000001);
      if (indice < 0) throw new Error('Os itens mudaram desde o rateio. Confira o pedido antes de retirar o valor embutido.');
      const linha = disponiveis.splice(indice, 1)[0];
      const acrescimo = numero(linha.acrescimoUnitario, 'Acréscimo');
      const base = numero(linha.precoBase, 'Preço-base');
      if (base < 0 || acrescimo < 0 || Math.abs(base + acrescimo - preco) >= 0.000001) {
        throw new Error('O preço atual é incompatível com o valor embutido. Confira o pedido.');
      }
      return { precoBase: arredondar(base), acrescimoUnitario: arredondar(acrescimo) };
    });
    if (disponiveis.length) throw new Error('Os itens mudaram desde o rateio. Recarregue o pedido antes de editar.');
    const temporarios = itens.map((item, index) => ({ ...item, __valorEmbutido: planos[index] }));
    // Serializar apenas lê: carregar pedidos antigos preserva seu valor aplicado,
    // inclusive a diferença de arredondamento original, até edição explícita.
    const estado = serializar(temporarios, metadata);
    itens.forEach((item, index) => { item.__valorEmbutido = planos[index]; });
    return estado;
  }

  function aplicar(itens, produto, anterior = null) {
    if (!itens.length) throw new Error('Adicione os itens do pedido antes de embutir um valor.');
    const valor = arredondar(numero(produto.preco ?? produto.valor, 'Preço do produto'), 2);
    const temporarios = itens.map(clonar);
    if (anterior && temporarios.some(item => !item.__valorEmbutido)) carregar(temporarios, anterior);
    const estado = recalcular(temporarios, {
      versao: 1,
      produto: {
        id: Number(produto.id) || null,
        itemLegado: Number(produto.item_legado ?? produto.itemLegado) || null,
        nome: String(produto.nome || 'Produto')
      },
      valor
    });
    itens.splice(0, itens.length, ...temporarios);
    return estado;
  }

  function definirPreco(item, novoPreco, opcoes = {}) {
    novoPreco = arredondar(numero(novoPreco, 'Preço'));
    const acrescimo = Number(item.__valorEmbutido?.acrescimoUnitario || 0);
    const base = arredondar(opcoes.base ? novoPreco : novoPreco - acrescimo);
    if (base < 0) throw new Error('Esse preço é menor que o acréscimo embutido. Retire o valor embutido antes de reduzir o preço.');
    if (item.__valorEmbutido) item.__valorEmbutido.precoBase = base;
    item.preco = arredondar(base + acrescimo);
    atualizarSubtotal(item);
    return item.preco;
  }

  function remover(itens, metadata) {
    const temporarios = itens.map(clonar);
    if (metadata && temporarios.length && temporarios.some(item => !item.__valorEmbutido)) carregar(temporarios, metadata);
    const haviaRateio = temporarios.some(item => item.__valorEmbutido);
    if (!haviaRateio) return null;
    const grupos = agruparBases(temporarios);
    const restaurados = grupos.map(grupo => {
      if (grupo.base < 0 || grupo.quantidade <= 0) throw new Error('Os preços-base e quantidades são inválidos.');
      const item = grupo.item;
      item.preco = grupo.base;
      item.quantidade = grupo.quantidade;
      delete item.__valorEmbutido;
      atualizarSubtotal(item);
      return item;
    });
    itens.splice(0, itens.length, ...restaurados);
    return null;
  }

  return { simular, aplicar, carregar, recalcular, definirPreco, remover, serializar };
});
